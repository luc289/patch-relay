#!/usr/bin/env node
'use strict';

/**
 * Construit l'entrée `change-request` de l'action ServiceNow/servicenow-devops-change.
 * Le JSON est généré ici (et non interpolé dans le YAML) pour éviter toute
 * injection via le titre de PR, les noms de dépendances, etc.
 *
 * Changement de type normal, modèle « DevOps Simplified » (sys_id fourni par
 * SN_CHG_MODEL_ID). L'approbation est décidée côté ServiceNow par la
 * politique « DevOps Simplified Model Change policy » : le pipeline ne fait
 * que documenter l'évaluation du risque dans le changement.
 * Note : l'action n'accepte pas risk, impact ni risk_impact_analysis.
 */

const fs = require('node:fs');

function buildPayload(env) {
  const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const description = [
    `Origine : ${env.ORIGIN || 'manual'}`,
    `PR : ${env.PR_NUMBER || 'n/a'}`,
    `Dépendances : ${env.DEPENDENCIES || 'n/a'}`,
    `Avis de sécurité : ${env.ADVISORIES || 'n/a'}`,
    `Type de mise à jour : ${env.UPDATE_TYPE || 'n/a'}`,
    `Risk gate : risque ${env.RISK || 'n/a'}, chemin automatisé ${env.ELIGIBLE === 'true' ? 'oui' : 'non'}`,
    `Motifs : ${env.RISK_REASONS || 'n/a'}`,
    `Commit : ${env.GITHUB_SHA}`,
    `Exécution : ${runUrl}`,
  ].join('\n');

  const attributes = {
    type: 'normal',
    short_description: env.ORIGIN === 'dependabot'
      ? `[Pipeline] Correctif de sécurité ${env.DEPENDENCIES || ''} -> prod`.replace(/\s+/g, ' ').trim()
      : '[Pipeline] Livraison patch-relay -> prod',
    description,
    justification: 'Remédiation automatisée de vulnérabilité détectée par l\'analyse des dépendances.',
    implementation_plan: 'Déploiement automatisé par GitHub Actions dans la fenêtre du changement; sonde /health après déploiement.',
    backout_plan: 'Revert du commit sur main, puis redéploiement de la version précédente par le pipeline.',
    test_plan: 'Tests unitaires, analyse Trivy (SCA) et CodeQL (SAST) exécutés par le pipeline; sonde de santé après déploiement.',
  };
  if (env.SN_CHG_MODEL_ID) attributes.chg_model = env.SN_CHG_MODEL_ID;
  if (env.SN_ASSIGNMENT_GROUP) attributes.assignment_group = env.SN_ASSIGNMENT_GROUP;
  if (env.SN_CMDB_CI) attributes.cmdb_ci = env.SN_CMDB_CI;

  return { setCloseCode: 'true', autoCloseChange: true, attributes };
}

if (require.main === module) {
  const json = JSON.stringify(buildPayload(process.env));
  console.log(json);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `json=${json}\n`);
}

module.exports = { buildPayload };
