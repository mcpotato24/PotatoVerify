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
	let shutdownPromise;

	const shutdown = async () => {
		if (shutdownPromise) return shutdownPromise;
		process.removeListener('SIGINT', shutdown);
		process.removeListener('SIGTERM', shutdown);
		shutdownPromise = (async () => {
			try {
				await bot?.destroy();
			} finally {
				users.close();
			}
		})();
		return shutdownPromise;
	};

	try {
		users.migrateLegacyJson(config.legacyJsonPath || path.join(__dirname, 'user-data.json'));
		bot = createBot({ config, users, getMinecraftProfile, logger });
		process.once('SIGINT', shutdown);
		process.once('SIGTERM', shutdown);
		await bot.login(config.token);
		return { bot, users, shutdown };
	} catch (error) {
		await shutdown();
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
