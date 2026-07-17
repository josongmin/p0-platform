#!/usr/bin/env bash
# 적대적 e2e 시나리오 스위트 — 실제 test-mode Stripe + 실제 webhook.
# 사전: .env(루트)에 STRIPE_SECRET_KEY(sk_test), STRIPE_PRICE_TEAM_MONTHLY/BUSINESS_MONTHLY,
#       STRIPE_METER_AI_TOKENS(=meter event_name), STRIPE_WEBHOOK_SECRET(=stripe listen --print-secret)
# 실행: (accounts 디렉토리에서) bash e2e-scenarios.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACC="$ROOT/apps/accounts"
BASE=http://localhost:4000
ORIGIN="Origin: http://localhost:4000"
PASS=0; FAIL=0; RESULTS=()

pyget() { python3 -c "import json,sys; s=sys.stdin.read(); s=s[s.find('{'):]; print(json.loads(s).get('$1',''))" 2>/dev/null; }
ok()   { PASS=$((PASS+1)); RESULTS+=("  ✅ $1"); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("  ❌ $1"); echo "  ❌ $1  ($2)"; }
price(){ grep "^$1=" "$ROOT/.env" | cut -d= -f2; }
skey(){ grep '^STRIPE_SECRET_KEY=' "$ROOT/.env" | cut -d= -f2; }

# ── 유틸: 유저+org+쿠키 ──────────────────────────────────
mk_user_org() { # echo "cookie|orgId|userId|email"
  local jar; jar="$(mktemp)"; local email="e2e_${RANDOM}_$(date +%s)@p0.test"; local slug="e2e${RANDOM}$(date +%s)"
  local su; su="$(mktemp)"
  curl -s -c "$jar" -X POST $BASE/api/auth/sign-up/email -H "$ORIGIN" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Str0ng!passw0rd\",\"name\":\"e2e\"}" -o "$su"
  local uid; uid=$(python3 -c "import json;print(json.load(open('$su')).get('user',{}).get('id',''))" 2>/dev/null)
  local org; org="$(mktemp)"
  curl -s -b "$jar" -c "$jar" -X POST $BASE/api/auth/organization/create -H "$ORIGIN" -H 'content-type: application/json' \
    -d "{\"name\":\"o\",\"slug\":\"$slug\"}" -o "$org"
  local oid; oid=$(pyget id < "$org")
  echo "$jar|$oid|$uid|$email"
}
svc_key() { # $1=jar $2=orgId → echo key
  curl -s -b "$1" -c "$1" -X POST $BASE/api/auth/api-key/create -H "$ORIGIN" -H 'content-type: application/json' \
    -d "{\"name\":\"svc\",\"metadata\":{\"orgId\":\"$2\"}}" | pyget key
}
sub_for() { # $1=orgId $2=price → echo "cus|sub"
  local cus sub pm
  cus=$(stripe customers create -d "metadata[orgId]=$1" 2>/dev/null | pyget id)
  pm=$(stripe payment_methods attach pm_card_visa --customer "$cus" 2>/dev/null | pyget id)
  stripe customers update "$cus" -d "invoice_settings[default_payment_method]=$pm" >/dev/null 2>&1
  sub=$(stripe subscriptions create --customer "$cus" -d "items[0][price]=$2" -d "metadata[orgId]=$1" 2>/dev/null | pyget id)
  echo "$cus|$sub"
}
poll_status() { # $1=jar $2=orgId $3=want → 0 if reached
  for _ in $(seq 1 20); do
    local s; s=$(curl -s -b "$1" $BASE/v1/billing/$2 | pyget status)
    [ "$s" = "$3" ] && return 0; sleep 1
  done; return 1
}

echo "════════ 적대적 e2e 시나리오 스위트 (실 Stripe) ════════"

# ── S1: 구독 → active ──────────────────────────────────
echo "[S1] 구독 생성 → webhook → active"
IFS="|" read -r JAR ORG USR EM <<< "$(mk_user_org)"
IFS='|' read -r CUS SUB <<< "$(sub_for "$ORG" "$(price STRIPE_PRICE_TEAM_MONTHLY)")"
if poll_status "$JAR" "$ORG" active; then
  P=$(curl -s -b "$JAR" $BASE/v1/billing/$ORG | pyget plan)
  [ "$P" = "team" ] && ok "S1 구독→active, plan=team" || bad "S1 plan" "got $P"
else bad "S1 active 미반영" "timeout"; fi

# ── S2: 미터 정확도 (100+250+999 = 1349 정확 집계) ──────
echo "[S2] usage 3건 → relay → Stripe 미터 aggregated == 1349"
KEY=$(svc_key "$JAR" "$ORG")
for q in 100 250 999; do
  curl -s -X POST $BASE/v1/usage -H "x-api-key: $KEY" -H 'content-type: application/json' \
    -d "{\"orgId\":\"$ORG\",\"metric\":\"ai_tokens\",\"quantity\":$q,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"idempotencyKey\":\"s2-$q-$RANDOM\"}" >/dev/null
done
(cd "$ACC" && bun run src/scripts/relay-usage.ts >/tmp/relay.json 2>/dev/null)
RELAYED=$(pyget relayed < /tmp/relay.json)
MID=$(stripe billing meters list --limit 10 2>/dev/null | python3 -c "import json,sys; s=sys.stdin.read(); s=s[s.find('{'):]; d=json.loads(s); print(next((m['id'] for m in d['data'] if m.get('event_name')=='$(price STRIPE_METER_AI_TOKENS)'),''))")
NOW=$(date +%s); ST=$(( (NOW/3600)*3600 - 3600 )); EN=$(( (NOW/3600)*3600 + 3600 ))
# Stripe 미터 집계는 eventual(~40-60s 지연) → 넉넉히 폴링
AGG=0
for _ in $(seq 1 25); do
  AGG=$(curl -s -G "https://api.stripe.com/v1/billing/meters/$MID/event_summaries" -u "$(skey):" \
    -d "customer=$CUS" -d "start_time=$ST" -d "end_time=$EN" -d "value_grouping_window=hour" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(e.get('aggregated_value',0) for e in d.get('data',[])))" 2>/dev/null)
  { [ "$AGG" = "1349.0" ] || [ "$AGG" = "1349" ]; } && break; sleep 2
done
[ "$RELAYED" = "3" ] && ok "S2 relayed=3" || bad "S2 relayed" "got $RELAYED"
[ "$AGG" = "1349.0" ] || [ "$AGG" = "1349" ] && ok "S2 미터 정확도 aggregated=$AGG" || bad "S2 미터값" "got $AGG (집계지연?)"

# ── S3: 크로스테넌트 — orgA 키로 orgB usage → 403 ──────
echo "[S3] 크로스테넌트 격리"
IFS="|" read -r JARB ORGB USRB EMB <<< "$(mk_user_org)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/v1/usage -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d "{\"orgId\":\"$ORGB\",\"metric\":\"ai_tokens\",\"quantity\":1,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"idempotencyKey\":\"s3-$RANDOM\"}")
[ "$CODE" = "403" ] && ok "S3 orgA키→orgB usage 403" || bad "S3 격리실패" "got $CODE"

# ── S4: usage 멱등 (같은 idempotencyKey → 1건) ──────────
echo "[S4] usage 멱등"
IK="s4-fixed-$RANDOM"
for _ in 1 2 3; do curl -s -X POST $BASE/v1/usage -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d "{\"orgId\":\"$ORG\",\"metric\":\"scans\",\"quantity\":5,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"idempotencyKey\":\"$IK\"}" >/dev/null; done
CNT=$(docker compose -f "$ROOT/docker-compose.yml" exec -T postgres psql -U p0 -d p0 -tA -c "SELECT count(*) FROM usage_events WHERE idempotency_key='$IK';" 2>/dev/null | tr -d '[:space:]')
[ "$CNT" = "1" ] && ok "S4 3회 POST → 1건만 적재" || bad "S4 멱등실패" "count=$CNT"

# ── S5: 중복구독 가드 (active org → checkout 400) ──────
echo "[S5] 중복구독 가드"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST $BASE/v1/billing/$ORG/checkout -H "$ORIGIN" -H 'content-type: application/json' -d '{"plan":"team","cycle":"monthly"}')
[ "$CODE" = "400" ] && ok "S5 active org checkout → 400" || bad "S5 중복구독 미차단" "got $CODE"

# ── S6: 플랜 업그레이드 (team→business) → webhook → epoch bump ──
echo "[S6] 플랜 변경 team→business + epoch bump"
EP0=$(curl -s "$BASE/v1/service/entitlements/$ORG/epoch" -H "x-api-key: $KEY" | pyget epoch)
ITEM=$(stripe subscriptions retrieve "$SUB" 2>/dev/null | python3 -c "import json,sys; s=sys.stdin.read(); s=s[s.find('{'):]; print(json.loads(s)['items']['data'][0]['id'])" 2>/dev/null)
stripe subscriptions update "$SUB" -d "items[0][id]=$ITEM" -d "items[0][price]=$(price STRIPE_PRICE_BUSINESS_MONTHLY)" -d "proration_behavior=none" >/dev/null 2>&1
sleep 4
P=$(curl -s -b "$JAR" $BASE/v1/billing/$ORG | pyget plan)
EP1=$(curl -s "$BASE/v1/service/entitlements/$ORG/epoch" -H "x-api-key: $KEY" | pyget epoch)
[ "$P" = "business" ] && ok "S6 플랜→business 반영" || bad "S6 플랜변경" "got $P"
[ "$EP1" -gt "$EP0" ] 2>/dev/null && ok "S6 epoch bump ($EP0→$EP1)" || bad "S6 epoch" "$EP0→$EP1"

# ── S7: epoch — 멤버 초대→수락 시 bump (afterAcceptInvitation) ──
echo "[S7] 멤버십 변경(invite→accept) → epoch bump"
EP0=$(curl -s "$BASE/v1/service/entitlements/$ORG/epoch" -H "x-api-key: $KEY" | pyget epoch)
IFS="|" read -r JARM ORGM USRM EMM <<< "$(mk_user_org)"  # 초대받을 유저
INV=$(curl -s -b "$JAR" -X POST $BASE/api/auth/organization/invite-member -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMM\",\"role\":\"member\",\"organizationId\":\"$ORG\"}" | pyget id)
curl -s -b "$JARM" -X POST $BASE/api/auth/organization/accept-invitation -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"invitationId\":\"$INV\"}" >/dev/null 2>&1
sleep 1
EP1=$(curl -s "$BASE/v1/service/entitlements/$ORG/epoch" -H "x-api-key: $KEY" | pyget epoch)
[ "$EP1" -gt "$EP0" ] 2>/dev/null && ok "S7 멤버수락 epoch bump ($EP0→$EP1)" || bad "S7 epoch" "$EP0→$EP1 (inv=$INV)"

# ── S8: 크로스테넌트 epoch — orgA 키로 orgB epoch → 403 ──
echo "[S8] 서비스키 epoch 크로스테넌트"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/service/entitlements/$ORGB/epoch" -H "x-api-key: $KEY")
[ "$CODE" = "403" ] && ok "S8 orgA키→orgB epoch 403" || bad "S8 격리실패" "got $CODE"

# ── S9: org 삭제 → Stripe 구독 자동취소 ────────────────
echo "[S9] org 삭제 → Stripe 구독 자동취소 (beforeDeleteOrganization)"
IFS="|" read -r JARD ORGD USRD EMD <<< "$(mk_user_org)"
IFS='|' read -r CUSD SUBD <<< "$(sub_for "$ORGD" "$(price STRIPE_PRICE_TEAM_MONTHLY)")"
poll_status "$JARD" "$ORGD" active >/dev/null
curl -s -b "$JARD" -X POST $BASE/api/auth/organization/delete -H "$ORIGIN" -H 'content-type: application/json' \
  -d "{\"organizationId\":\"$ORGD\"}" >/dev/null 2>&1
sleep 3
SUBSTATUS=$(stripe subscriptions retrieve "$SUBD" 2>/dev/null | grep '"status"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
[ "$SUBSTATUS" = "canceled" ] && ok "S9 org삭제→Stripe구독 canceled" || bad "S9 자동취소 실패" "sub=$SUBSTATUS"

# ── S10: dunning (invoice.payment_failed) ──────────────
echo "[S10] dunning webhook"
BEFORE=$(tail -50 /tmp/e2e-server.log 2>/dev/null | grep -c payment_failed)
stripe trigger invoice.payment_failed >/dev/null 2>&1
sleep 3
AFTER=$(tail -80 /tmp/e2e-server.log 2>/dev/null | grep -c payment_failed)
[ "$AFTER" -gt "$BEFORE" ] 2>/dev/null && ok "S10 payment_failed 핸들러 처리" || bad "S10 dunning" "no handler log"

# ── S11: 취소 → canceled ──────────────────────────────
echo "[S11] 구독 취소 → webhook → canceled"
stripe subscriptions cancel "$SUB" --confirm >/dev/null 2>&1
if poll_status "$JAR" "$ORG" canceled; then ok "S11 취소→canceled"; else bad "S11 취소 미반영" "timeout"; fi

# ── 결과 ──────────────────────────────────────────────
echo ""
echo "════════ 결과: $PASS PASS / $FAIL FAIL ════════"
printf '%s\n' "${RESULTS[@]}"
[ "$FAIL" -eq 0 ] && echo "🎉 전 시나리오 통과" || echo "⚠️ 실패 있음"
exit $FAIL
