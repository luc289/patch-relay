#!/usr/bin/env node
'use strict';

/**
 * Pilote le cycle de vie d'un changement ServiceNow depuis le pipeline.
 *
 *   node scripts/servicenow-change.js create     -> crée le changement (standard si admissible, sinon normal)
 *   node scripts/servicenow-change.js wait       -> attend l'approbation (CHANGE_SYS_ID)
 *   node scripts/servicenow-change.js implement  -> passe en Implement
 *   node scripts/servicenow-change.js close      -> ferme (DEPLOY_OUTCOME=success|failure)
 *
 * Connexion : SN_INSTANCE (ex. dev12345), SN_USER, SN_PASSWORD.
 * Sans identifiants, le script fonctionne en mode simulation (DRY_RUN) et
 * journalise les appels qu'il aurait faits.
 *
 * Chemin automatisé : si ELIGIBLE=true et SN_STD_TEMPLATE_ID est défini, un
 * changement standard (préapprouvé) est créé à partir du modèle. Sinon, un
 * changement normal est créé et doit être approuvé dans ServiceNow.
 */

const fs = require('node:fs');

const env = process.env;
const DRY_RUN = !(env.SN_INSTANCE && env.SN_USER && env.SN_PASSWORD) || env.DRY_RUN === 'true';
const BASE = env.SN_INSTANCE
  ? (env.SN_INSTANCE.startsWith('http') ? env.SN_INSTANCE : `https://${env.SN_INSTANCE}.service-now.com`)
  : 'https://instance.service-now.com';

function output(key, value) {
  console.log(`${key}=${value}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function summary(md) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

async function sn(method, path, body) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ${method} ${BASE}${path}`);
    if (body) console.log(JSON.stringify(body, null, 2));
    return { result: { sys_id: { value: 'dryrun' }, number: { value: `CHG-DRYRUN-${env.GITHUB_RUN_ID || 'local'}` }, approval: 'approved', state: '-1' } };
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.SN_USER}:${env.SN_PASSWORD}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status} : ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

// Les API sn_chg_rest renvoient {value, display_value}; la Table API renvoie des chaînes.
const val = (f) => (f && typeof f === 'object' ? f.value : f);

function context() {
  const runUrl = env.GITHUB_SERVER_URL ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : 'local';
  const lines = [
    `Dépôt : ${env.GITHUB_REPOSITORY || 'local'}`,
    `Commit : ${env.GITHUB_SHA || 'n/a'}`,
    `Exécution : ${runUrl}`,
    `Environnement cible : ${env.ENV_NAME || 'prod'}`,
    `Origine : ${env.ORIGIN || 'manual'}`,
    `PR : ${env.PR_NUMBER || 'n/a'}`,
    `Dépendances : ${env.DEPENDENCIES || 'n/a'}`,
    `Avis de sécurité : ${env.ADVISORIES || 'n/a'}`,
    `Type de mise à jour : ${env.UPDATE_TYPE || 'n/a'}`,
    `Évaluation du risque : ${env.RISK || 'n/a'} — ${env.RISK_REASONS || ''}`,
  ];
  return { runUrl, text: lines.join('\n') };
}

async function create() {
  const { runUrl, text } = context();
  const eligible = env.ELIGIBLE === 'true';
  const riskMap = { low: '4', moderate: '3', high: '2' };
  const common = {
    short_description: `[Pipeline] Correctif de sécurité ${env.DEPENDENCIES || ''} -> ${env.ENV_NAME || 'prod'}`.trim(),
    description: text,
    justification: 'Remédiation automatisée de vulnérabilité détectée par l\'analyse des dépendances.',
    implementation_plan: 'Déploiement automatisé par GitHub Actions; sonde /health après déploiement.',
    backout_plan: 'Revert du commit sur main, puis redéploiement de la version précédente par le pipeline.',
    test_plan: 'Tests unitaires, analyse Trivy et sonde de santé exécutés par le pipeline.',
    correlation_id: `${env.GITHUB_REPOSITORY || 'local'}#${env.GITHUB_RUN_ID || '0'}`,
    correlation_display: 'GitHub Actions',
    category: 'Software',
  };
  if (env.SN_CMDB_CI) common.cmdb_ci = env.SN_CMDB_CI;
  if (env.SN_ASSIGNMENT_GROUP) common.assignment_group = env.SN_ASSIGNMENT_GROUP;

  let res;
  let type;
  if (eligible && env.SN_STD_TEMPLATE_ID) {
    type = 'standard';
    res = await sn('POST', `/api/sn_chg_rest/change/standard/${env.SN_STD_TEMPLATE_ID}`, common);
  } else {
    type = eligible ? 'normal (aucun modèle standard configuré)' : 'normal';
    res = await sn('POST', '/api/sn_chg_rest/change/normal', {
      ...common,
      risk: riskMap[env.RISK] || '3',
      impact: env.RISK === 'low' ? '3' : '2',
    });
  }
  const sysId = val(res.result.sys_id);
  const number = val(res.result.number);
  output('change_sys_id', sysId);
  output('change_number', number);
  output('change_type', type);
  summary(`### Changement ServiceNow\n\n- Numéro : **${number}**\n- Type : ${type}\n- Mode : ${DRY_RUN ? 'simulation (DRY_RUN)' : BASE}\n- Exécution : ${runUrl}`);
}

async function wait() {
  const sysId = env.CHANGE_SYS_ID;
  const timeoutMs = Number(env.WAIT_MINUTES || 30) * 60_000;
  const interval = Number(env.POLL_SECONDS || 30) * 1000;
  const start = Date.now();
  for (;;) {
    const res = await sn('GET', `/api/now/table/change_request/${sysId}?sysparm_fields=number,approval,state`);
    const approval = val(res.result.approval);
    console.log(`approbation=${approval} état=${val(res.result.state)}`);
    if (approval === 'approved') { output('approval', 'approved'); return; }
    if (approval === 'rejected') throw new Error('Changement rejeté dans ServiceNow : déploiement annulé.');
    if (Date.now() - start > timeoutMs) throw new Error('Délai d\'approbation dépassé.');
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function implement() {
  await sn('PATCH', `/api/now/table/change_request/${env.CHANGE_SYS_ID}`, { state: '-1' });
  console.log('Changement en Implement.');
}

async function close() {
  const ok = env.DEPLOY_OUTCOME === 'success';
  await sn('PATCH', `/api/now/table/change_request/${env.CHANGE_SYS_ID}`, { state: '0' });
  await sn('PATCH', `/api/now/table/change_request/${env.CHANGE_SYS_ID}`, {
    state: '3',
    close_code: ok ? 'successful' : 'unsuccessful',
    close_notes: ok ? 'Déploiement réussi, sonde de santé OK.' : 'Échec du déploiement, retour arrière déclenché.',
  });
  console.log(`Changement fermé (${ok ? 'réussi' : 'non réussi'}).`);
  summary(`- Fermeture : **${ok ? 'réussi' : 'non réussi'}**`);
}

const commands = { create, wait, implement, close };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error(`Commande inconnue : ${cmd}. Attendu : ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}
if (DRY_RUN) console.log('Mode simulation : aucun identifiant ServiceNow fourni.');
commands[cmd]().catch((e) => { console.error(e.message); process.exit(1); });
