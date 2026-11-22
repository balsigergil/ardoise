#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { runMigrations } from '@ardoise/db';
import { createApp } from './bootstrap.js';
import { parseCommand, usage } from './command.js';
import { ConfigError, loadConfig, type Config } from './config/config.js';

function configOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }
}

const command = parseCommand(process.argv.slice(2));

switch (command.kind) {
  case 'help':
    console.log(usage);
    break;
  case 'unknown':
    console.error(`Unknown command "${command.name}".\n\n${usage}`);
    process.exit(2);
    break;
  case 'migrate': {
    const config = configOrExit();
    await runMigrations({ connectionString: config.databaseUrl });
    console.log('Migrations applied.');
    break;
  }
  case 'serve': {
    const config = configOrExit();
    const app = await createApp(config);
    await app.listen(config.port, config.host);
    break;
  }
}
