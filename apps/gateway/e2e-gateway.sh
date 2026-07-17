#!/usr/bin/env bash
# gateway ↔ accounts 크로스서비스 e2e — epoch 소비 + 서버측 쿼터 + usage 루프 증명.
# 사전: accounts 서버(:4000) 기동. 이 스크립트가 org/키를 만들어 gateway(:4100)를 띄운다.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACC=http://localhost:4000; GW=http://localhost:4100
ORIGIN="Origin: http://localhost:4000"
PASS=0; FAIL=0
pyget() { python3 -c "import json,sys; s=sys.stdin.read(); s=s[s.find('{'):]; print(json.loads(s).get('$1',''))" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1  ($2)"; }

echo "════ gateway↔accounts 크로스 e2e ════"
JAR=$(mktemp); EMAIL="gw_$(date +%s)@p0.test"; SLUG="gw$(date +%s)"
curl -s -c $JAR -X POST $ACC/api/auth/sign-up/email -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Str0ng!passw0rd\",\"name\":\"gw\"}" >/dev/null
ORG=$(curl -s -b $JAR -c $JAR -X POST $ACC/api/auth/organization/create -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"name\":\"gw\",\"slug\":\"$SLUG\"}" | pyget id)
# 활성 org로 세팅 (JWT의 activeOrganizationId → 클레임 org)
curl -s -b $JAR -c $JAR -X POST $ACC/api/auth/organization/set-active -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"organizationId\":\"$ORG\"}" >/dev/null
KEY=$(curl -s -b $JAR -c $JAR -X POST $ACC/api/auth/api-key/create -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"name\":\"gw-svc\",\"metadata\":{\"orgId\":\"$ORG\"}}" | pyget key)
sleep 1  # org 생성 시 owner-추가 epoch bump 정착 대기 (안 하면 토큰이 born-stale)
TOKEN=$(curl -s -b $JAR $ACC/api/auth/token | pyget token)
echo "  org=$ORG  token=${TOKEN:0:16}...  key=${KEY:0:10}..."

# gateway 기동 (org-스코프 서비스키 주입, epoch 캐시 1s로 짧게 → revocation 빠른 검증)
lsof -ti:4100 2>/dev/null | xargs kill 2>/dev/null; sleep 1
( cd "$ROOT/apps/gateway" && GATEWAY_SERVICE_KEY="$KEY" EPOCH_CACHE_TTL_MS=1000 PORT=4100 \
  nohup bun run src/index.ts > /tmp/gw.log 2>&1 & )
sleep 2
curl -s --max-time 3 $GW/health >/dev/null && echo "  gateway up" || { echo "gateway 기동 실패"; cat /tmp/gw.log; exit 1; }

infer() { curl -s -o /tmp/gw-resp.json -w '%{http_code}' -X POST $GW/v1/infer \
  -H "authorization: Bearer $1" -H 'content-type: application/json' -d "{\"tokens\":$2}"; }

# G1: 유효 토큰 infer → 200 + usage 발행
echo "[G1] 유효 토큰 infer → 200 + usage 발행"
CODE=$(infer "$TOKEN" 1000)
[ "$CODE" = "200" ] && ok "G1 infer 200 (remaining=$(pyget remaining < /tmp/gw-resp.json))" || bad "G1" "code=$CODE $(cat /tmp/gw-resp.json)"
# usage가 accounts로 실제 발행됐나 (gateway→accounts /v1/usage 루프)
EMITTED=$(pyget emitted < /tmp/gw-resp.json)
[ "$EMITTED" = "True" ] && ok "G1 usage accounts 발행 성공 (미터링 루프 닫힘)" || bad "G1 usage 발행 실패" "emitted=$EMITTED"

# G2: 서버측 쿼터 429 (free=aiTokensPerMonth 100000; 남은 걸 초과 요청)
echo "[G2] 서버측 쿼터 초과 → 429"
CODE=$(infer "$TOKEN" 100000)   # 이미 1000 씀 → 100000 추가는 free 한도(100000) 초과
[ "$CODE" = "429" ] && ok "G2 쿼터 초과 429 (used=$(pyget used < /tmp/gw-resp.json))" || bad "G2 쿼터 미강제" "code=$CODE $(cat /tmp/gw-resp.json)"

# G3: revocation — plan 변경으로 epoch bump → 같은 토큰 stale 401
echo "[G3] epoch revocation — 권한변경 후 기존 토큰 → 401 stale"
# 멤버 추가로 epoch bump (invite→accept 대신 간단히: 두번째 유저 초대→수락)
JAR2=$(mktemp); EMAIL2="gw2_$(date +%s)@p0.test"
curl -s -c $JAR2 -X POST $ACC/api/auth/sign-up/email -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL2\",\"password\":\"Str0ng!passw0rd\",\"name\":\"m\"}" >/dev/null
INV=$(curl -s -b $JAR -X POST $ACC/api/auth/organization/invite-member -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL2\",\"role\":\"member\",\"organizationId\":\"$ORG\"}" | pyget id)
curl -s -b $JAR2 -X POST $ACC/api/auth/organization/accept-invitation -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"invitationId\":\"$INV\"}" >/dev/null
sleep 2  # epoch bump + 캐시 TTL(1s) 만료 대기
CODE=$(infer "$TOKEN" 10)
[ "$CODE" = "401" ] && ok "G3 권한변경 후 기존 토큰 stale 401 (revocation 작동)" || bad "G3 revocation 미작동" "code=$CODE $(cat /tmp/gw-resp.json)"

# G4: 신규 토큰(갱신)은 다시 통과
echo "[G4] 토큰 갱신 → 다시 통과"
sleep 1  # G3 invite→accept bump 정착 후 갱신 토큰 발급
TOKEN2=$(curl -s -b $JAR $ACC/api/auth/token | pyget token)
CODE=$(infer "$TOKEN2" 10)
[ "$CODE" = "200" ] && ok "G4 갱신 토큰 200" || bad "G4" "code=$CODE $(cat /tmp/gw-resp.json)"

lsof -ti:4100 2>/dev/null | xargs kill 2>/dev/null
echo ""
echo "════ gateway e2e: $PASS PASS / $FAIL FAIL ════"
exit $FAIL
