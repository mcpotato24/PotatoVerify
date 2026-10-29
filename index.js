'use strict';

const path = require('node:path');
const { createBot } = require('./src/bot');
const { loadConfig } = require('./src/config');
const { openDatabase } = require('./src/database');
const { getMinecraftProfile } = require('./src/minecraft');

async function main({ logger = console } = {}) {
	const config = loadConfig();
	const users = openDatabase(config.databasePath);
	let bot;
	let closed = false;

	const shutdown = () => {
		if (closed) return;
		closed = true;
		process.removeListener('SIGINT', shutdown);
		process.removeListener('SIGTERM', shutdown);
		bot?.destroy();
		users.close();
	};

	try {
		users.migrateLegacyJson(config.legacyJsonPath || path.join(__dirname, 'user-data.json'));
		bot = createBot({ config, users, getMinecraftProfile, logger });
		process.once('SIGINT', shutdown);
		process.once('SIGTERM', shutdown);
		await bot.login(config.token);
		return { bot, users, shutdown };
	} catch (error) {
		shutdown();
		throw error;
	}
}

if (require.main === module) {
	require('dotenv').config({ quiet: true });
	main().catch(error => {
		console.error('Discord 봇 시작 실패:', error);
		process.exitCode = 1;
	});
}

module.exports = { main };
