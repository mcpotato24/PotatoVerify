'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
