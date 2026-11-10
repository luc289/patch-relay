'use strict';

const express = require('express');
const pkg = require('../package.json');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Sonde de santé utilisée par le pipeline après chaque déploiement
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: pkg.version, env: process.env.APP_ENV || 'local' });
  });

  // Endpoint métier fictif : renvoie l'inventaire des dépendances du service
  app.get('/api/inventory', (_req, res) => {
    res.json({ service: pkg.name, dependencies: pkg.dependencies });
  });

  return app;
}

module.exports = { createApp };
