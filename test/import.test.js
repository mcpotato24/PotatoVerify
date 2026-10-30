'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Module = require('node:module');
const { test } = require('node:test');

test('루트 모듈 import만으로 login, DB, 로그 부작용이 발생하지 않는다', t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'potatoverify-import-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const entrypoint = path.resolve(__dirname, '..', 'index.js');
	const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', entrypoint], {
		cwd: directory,
		encoding: 'utf8',
		env: {
			...process.env,
			DISCORD_TOKEN: 'would-login-if-import-were-eager',
			GUILD_ID: '123456789012345678',
			ADMIN_ROLE_ID: '123456789012345679',
			VERIFIED_ROLE_ID: '123456789012345680',
			UNVERIFIED_ROLE_ID: '123456789012345681',
			DATABASE_PATH: 'import-side-effect.sqlite',
		},
		timeout: 5_000,
	});

	assert.equal(result.signal, null, `import가 제한 시간 안에 끝나야 합니다: ${result.stderr}`);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, '');
	assert.equal(result.stderr, '');
	assert.deepEqual(fs.readdirSync(directory), []);
});

test('async shutdown은 Discord 클라이언트 종료를 기다린 뒤 DB를 닫는다', async () => {
	const events = [];
	let finishDestroy;
	const users = {
		migrateLegacyJson: () => events.push('migrate'),
		close: () => events.push('database.close'),
	};
	const bot = {
		login: async () => events.push('bot.login'),
		destroy: () => {
			events.push('bot.destroy:start');
			return new Promise(resolve => {
				finishDestroy = () => {
					events.push('bot.destroy:end');
					resolve();
				};
			});
		},
	};
	const entrypoint = require.resolve('../index');
	delete require.cache[entrypoint];
	const originalLoad = Module._load;
	Module._load = function(request, parent, isMain) {
		if (parent?.filename === entrypoint) {
			if (request === './src/config') {
				return { loadConfig: () => ({ token: 'token', databasePath: ':memory:' }) };
			}
			if (request === './src/database') return { openDatabase: () => users };
			if (request === './src/bot') return { createBot: () => bot };
			if (request === './src/minecraft') return { getMinecraftProfile: async () => {} };
		}
		return originalLoad.call(this, request, parent, isMain);
	};

	let main;
	try {
		({ main } = require(entrypoint));
	} finally {
		Module._load = originalLoad;
		delete require.cache[entrypoint];
	}

	const application = await main();
	assert.deepEqual(events, ['migrate', 'bot.login']);
	const firstShutdown = application.shutdown();
	const secondShutdown = application.shutdown();
	await Promise.resolve();
	assert.deepEqual(events, ['migrate', 'bot.login', 'bot.destroy:start']);

	finishDestroy();
	await Promise.all([firstShutdown, secondShutdown]);
	assert.deepEqual(events, [
		'migrate',
		'bot.login',
		'bot.destroy:start',
		'bot.destroy:end',
		'database.close',
	]);
});
