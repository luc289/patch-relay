#!/usr/bin/env node
'use strict';

/**
 * Risk gate : décide si une livraison est admissible au chemin automatisé
 * (changement à faible risque, approuvé sans intervention humaine).
 *
 * Entrées (variables d'environnement) :
 *   TRIVY_REPORT   chemin du rapport Trivy JSON (optionnel)
 *   UPDATE_TYPE    version-update:semver-patch | -minor | -major (fourni par Dependabot)
 *   ORIGIN         dependabot | manual
 *   CHANGED_FILES  liste des fichiers modifiés, séparés par des retours de ligne
 *   MAX_SEVERITY   sévérité résiduelle tolérée (défaut : MEDIUM)
 *
 * Sorties : risk, eligible, reasons (stdout + GITHUB_OUTPUT si présent)
 */

const fs = require('node:fs');

const SEVERITIES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const MANIFESTS = /^(package\.json|package-lock\.json|\.github\/dependabot\.yml)$/;

function countFindings(reportPath) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  if (!reportPath || !fs.existsSync(reportPath)) return { counts, available: false };
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const result of report.Results || []) {
    for (const v of result.Vulnerabilities || []) {
      counts[v.Severity] = (counts[v.Severity] || 0) + 1;
    }
  }
  return { counts, available: true };
}

function evaluate(input) {
  const reasons = [];
  let eligible = true;

  const origin = (input.origin || 'manual').toLowerCase();
  if (origin !== 'dependabot') {
    eligible = false;
    reasons.push(`origine « ${origin} » : seuls les correctifs Dependabot sont admissibles au chemin automatisé`);
  }

  const updateType = input.updateType || '';
  if (!/semver-(patch|minor)$/.test(updateType)) {
    eligible = false;
    reasons.push(`type de mise à jour « ${updateType || 'inconnu'} » : seuls patch et minor sont admissibles`);
  }

  const files = (input.changedFiles || '').split('\n').map((f) => f.trim()).filter(Boolean);
  const outOfScope = files.filter((f) => !MANIFESTS.test(f));
  if (outOfScope.length) {
    eligible = false;
    reasons.push(`fichiers hors manifeste modifiés : ${outOfScope.join(', ')}`);
  }

  const maxIdx = SEVERITIES.indexOf((input.maxSeverity || 'MEDIUM').toUpperCase());
  const { counts, available } = countFindings(input.trivyReport);
  if (!available) {
    reasons.push('rapport Trivy absent : aucune vulnérabilité résiduelle évaluée');
  }
  const blocking = SEVERITIES.filter((s, i) => i > maxIdx && counts[s] > 0);
  if (blocking.length) {
    eligible = false;
    reasons.push(`vulnérabilités résiduelles bloquantes : ${blocking.map((s) => `${s}=${counts[s]}`).join(', ')}`);
  }

  let risk = 'low';
  if (!eligible) risk = blocking.includes('CRITICAL') || /major$/.test(updateType) ? 'high' : 'moderate';
  if (eligible) reasons.push('correctif de dépendance patch/minor, aucun résiduel bloquant : changement faible risque');

  return { risk, eligible, reasons, counts };
}

if (require.main === module) {
  const result = evaluate({
    origin: process.env.ORIGIN,
    updateType: process.env.UPDATE_TYPE,
    changedFiles: process.env.CHANGED_FILES,
    trivyReport: process.env.TRIVY_REPORT,
    maxSeverity: process.env.MAX_SEVERITY,
  });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `risk=${result.risk}\neligible=${result.eligible}\nreasons=${result.reasons.join(' | ')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Risk gate\n\n- Risque : **${result.risk}**\n- Chemin automatisé : **${result.eligible ? 'oui' : 'non'}**\n${result.reasons.map((r) => `- ${r}`).join('\n')}\n`);
  }
}

module.exports = { evaluate };
