# 감자서버 보안 인증 Discord 봇

Minecraft 계정과 Discord 사용자를 SQLite로 연결하고, 서버 재가입 시 인증 상태에 맞는 역할을 다시 부여하는 Discord 봇입니다.

## 요구 사항

- Node.js 26.13.0 이상, 27 미만
- Discord 봇의 **Server Members Intent**
- 인증 역할과 미인증 역할보다 위에 있는 봇 역할 및 역할 관리 권한

## 설치와 실행

```bash
npm install
cp .env.example .env
npm start
```

`.env`에서 다음 값을 설정합니다.

| 변수 | 내용 |
| --- | --- |
| `DISCORD_TOKEN` | Discord Developer Portal에서 발급한 봇 토큰 |
| `GUILD_ID` | 슬래시 명령을 등록할 서버 ID |
| `ADMIN_ROLE_ID` | 관리자 명령을 사용할 수 있는 역할 ID |
| `VERIFIED_ROLE_ID` | 인증된 사용자 역할 ID |
| `UNVERIFIED_ROLE_ID` | 미인증 사용자 역할 ID |
| `DATABASE_PATH` | 선택 항목. SQLite 파일 경로이며 기본값은 프로젝트 루트의 `user-data.sqlite` |

Discord ID와 역할 ID는 17~20자리 숫자여야 하고, 세 역할 ID는 서로 달라야 합니다. 상대 `DATABASE_PATH`는 현재 작업 디렉터리와 관계없이 프로젝트 루트를 기준으로 해석됩니다. DB 파일의 상위 디렉터리가 없으면 시작할 때 자동으로 생성합니다.

테스트는 다음 명령으로 실행합니다.

```bash
npm test
```

## 슬래시 명령

- `/인증 닉네임`: 자신의 Minecraft 계정을 인증합니다.
- `/수동등록 사용자 닉네임`: 관리자가 다른 사용자를 등록합니다.
- `/인증조회 [사용자] [uuid]`: 관리자가 Discord 사용자 또는 Minecraft UUID로 인증 정보를 조회합니다.
- `/전송 내용`: 관리자가 현재 채널에 봇 메시지를 전송합니다.

`/인증` 외의 명령은 Discord 관리자 권한 또는 `ADMIN_ROLE_ID` 역할이 필요합니다.

## 데이터와 migration

SQLite schema의 현재 버전은 v3입니다. 새 DB는 즉시 v3로 생성되며, `users` 테이블은 정규화한 Minecraft UUID, Discord ID, 마지막으로 확인한 Minecraft 이름, 최초 인증 시각(`first_verified_at`), 마지막 인증 시각(`last_verified_at`)을 저장합니다. Minecraft UUID와 Discord ID에는 각각 고유 제약이 있어 한 계정을 둘 이상의 사용자에게 원자적으로 등록하지 않습니다.

기존 legacy `PRAGMA user_version = 0`/`1` DB는 서로 다른 최초·마지막 인증 시각을 그대로 보존해 v3로 migration됩니다. v2의 `verified_at`은 v3의 `first_verified_at`과 `last_verified_at` 모두에 복사됩니다. migration은 시작할 때 트랜잭션 안에서 실행되며, schema version이 지원 범위를 벗어나거나 알 수 없는 구형 테이블 구조이면 시작을 중단합니다.

루트의 기존 `user-data.json`은 최초 시작 시 한 번만 읽습니다. 유효한 UUID와 17~20자리 Discord ID가 있는 행만 가져오고, 완료 여부를 `schema_meta`에 기록해 이후 시작에서는 다시 가져오지 않습니다. 원본 JSON 파일은 자동으로 삭제하지 않습니다.

## 파일 구조

```text
index.js              실행 진입점과 종료 처리
src/config.js         환경변수 검증
src/database.js       SQLite v3 schema, migration, 사용자 저장소
src/minecraft.js      Mojang 프로필 조회
src/verification.js   인증 등록과 역할 동기화
src/bot.js            Discord 클라이언트, 명령 정의와 처리기
test/                 독립적인 node:test 테스트
.env.example          환경변수 예시
user-data.json        기존 설치에서 사용하는 일회성 이전 원본
```

`index.js`를 모듈로 가져오는 것만으로는 봇 로그인이나 DB 생성이 시작되지 않습니다. 실제 실행은 `npm start` 또는 `node index.js`로 합니다.
