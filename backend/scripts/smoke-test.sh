#!/usr/bin/env bash
set -uo pipefail
cd backend || exit 1

export PORT=4599
export ADMIN_EMAIL=admin@test.local
export ADMIN_PASSWORD=testpass123
export JWT_SECRET=test-secret-for-smoke-test
export GEMINI_API_KEY=dummy-key
export DB_CLIENT=sqlite
export SQLITE_PATH=./data/smoke_test.db
export CORS_ORIGINS=

rm -f data/smoke_test.db data/smoke_test.db-shm data/smoke_test.db-wal
npm run migrate --silent || exit 1

node src/server.js > /tmp/backend-smoke.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 40); do
  curl -fsS http://127.0.0.1:4599/api/health >/dev/null 2>&1 && break
  sleep 0.25
done

B=http://127.0.0.1:4599
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; PASS=$((PASS+1));
  else echo "FAIL  $1 expected=$2 actual=$3"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
field() { python3 -c "import json,sys;d=json.load(open('/tmp/body.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null || echo "PARSE_ERROR"; }

# --- signup -------------------------------------------------------------
SIGNUP_STATUS=$(code -X POST "$B/api/auth/signup" -H 'Content-Type: application/json' \
  -d '{"full_name":"Test Trader","username":"TestTrader","email":"trader@example.com","phone":"+8801700000000","password":"secret123","confirm_password":"secret123"}')
check "signup status" 201 "$SIGNUP_STATUS"
USER_TOKEN=$(field "d['token']")
USER_ID=$(field "d['user']['id']")
check "signup status field" PENDING "$(field "d['user']['account_status']")"
check "signup plan count" 2 "$(len_field=$(field "len(d['plans'])"); echo "$len_field")"

# duplicate signup
check "duplicate email rejected" 409 "$(code -X POST "$B/api/auth/signup" -H 'Content-Type: application/json' -d '{"full_name":"Test Trader","username":"other","email":"trader@example.com","password":"secret123","confirm_password":"secret123"}')"

# validation
check "short password rejected" 400 "$(code -X POST "$B/api/auth/signup" -H 'Content-Type: application/json' -d '{"full_name":"A B","username":"abc","email":"a@b.co","password":"short","confirm_password":"short"}')"
check "password mismatch rejected" 400 "$(code -X POST "$B/api/auth/signup" -H 'Content-Type: application/json' -d '{"full_name":"A B","username":"abc","email":"a@b.co","password":"secret123","confirm_password":"secret124"}')"

# --- login --------------------------------------------------------------
check "login by username" 200 "$(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"identifier":"testtrader","password":"secret123"}')"
check "login by email" 200 "$(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"identifier":"trader@example.com","password":"secret123"}')"
check "login bad password" 401 "$(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"identifier":"trader@example.com","password":"nope"}')"

# --- me -----------------------------------------------------------------
check "me without token" 401 "$(code "$B/api/auth/me")"
check "me with token" 200 "$(code "$B/api/auth/me" -H "Authorization: Bearer $USER_TOKEN")"
check "me exposes plans" 2 "$(field "len(d['plans'])")"
check "me exposes affiliate_link" "yes" "$(field "'affiliate_link' in d['settings'] and 'yes' or 'no'")"

# --- analysis gate ------------------------------------------------------
check "analyze blocked while pending" 403 "$(code -X POST "$B/api/analyze-chart" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d '{"imageBase64":"x"}')"
check "gate code" ACCOUNT_NOT_ACTIVE "$(field "d['code']")"

# --- admin --------------------------------------------------------------
check "admin login" 200 "$(code -X POST "$B/api/admin/login" -H 'Content-Type: application/json' -d '{"email":"admin@test.local","password":"testpass123"}')"
ADMIN_TOKEN=$(field "d['token']")
check "admin users requires auth" 401 "$(code "$B/api/admin/users")"
check "admin lists users" 200 "$(code "$B/api/admin/users?search=trader" -H "Authorization: Bearer $ADMIN_TOKEN")"
check "admin user found" 1 "$(field "d['total']")"

check "admin plans list" 200 "$(code "$B/api/admin/plans" -H "Authorization: Bearer $ADMIN_TOKEN")"
PLAN_ID=$(field "d['items'][1]['id']")

check "admin settings get" 200 "$(code "$B/api/admin/settings" -H "Authorization: Bearer $ADMIN_TOKEN")"
check "admin settings put" 200 "$(code -X PUT "$B/api/admin/settings" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"affiliate_link":"https://broker.example.com/ref/123","support_contact_link":"https://t.me/support"}')"
check "settings saved" "https://t.me/support" "$(field "d['settings']['support_contact_link']")"
check "invalid affiliate url rejected" 400 "$(code -X PUT "$B/api/admin/settings" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"affiliate_link":"not-a-url"}')"
check "invalid crypto network rejected" 400 "$(code -X PUT "$B/api/admin/settings" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"crypto_network":"ERC20"}')"
check "invalid crypto wallet rejected" 400 "$(code -X PUT "$B/api/admin/settings" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"crypto_network":"BEP20","crypto_wallet_address":"0x1234"}')"
check "crypto settings saved" 200 "$(code -X PUT "$B/api/admin/settings" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"crypto_network":"BEP20","crypto_wallet_address":"0x1111111111111111111111111111111111111111","bscscan_api_key":"smoke-explorer-key"}')"
check "crypto wallet stored" "0x1111111111111111111111111111111111111111" "$(field "d['settings']['crypto_wallet_address']")"

# --- crypto payments ----------------------------------------------------
code "$B/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" >/dev/null
check "public settings hide explorer key" "no" "$(field "'yes' if 'bscscan_api_key' in d['settings'] else 'no'")"
check "public settings expose wallet" "0x1111111111111111111111111111111111111111" "$(field "d['settings']['crypto_wallet_address']")"
check "create crypto payment" 201 "$(code -X POST "$B/api/payments/start" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d "{\"plan_id\":$PLAN_ID}")"
PAYMENT_ID=$(field "d['payment']['id']")
check "payment amount" 29 "$(field "d['payment']['expected_amount_usdt']")"
check "payment network" BEP20 "$(field "d['payment']['network']")"
check "payment pending" PENDING "$(field "d['payment']['status']")"
check "payment fetch" 200 "$(code "$B/api/payments/$PAYMENT_ID" -H "Authorization: Bearer $USER_TOKEN")"
check "payment owner id" "$USER_ID" "$(field "d['payment']['user_id']")"
check "verify requires tx hash" 400 "$(code -X POST "$B/api/payments/verify-crypto" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d "{\"payment_id\":$PAYMENT_ID}")"
check "malformed tx hash rejected" 400 "$(code -X POST "$B/api/payments/verify-crypto" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d "{\"payment_id\":$PAYMENT_ID,\"tx_hash\":\"0xdeadbeef\"}")"
curl -s -o /tmp/body.json "$B/api/payments/$PAYMENT_ID" -H "Authorization: Bearer $USER_TOKEN"
check "payment still pending" PENDING "$(field "d['payment']['status']")"
check "unknown payment 404" 404 "$(code "$B/api/payments/99999" -H "Authorization: Bearer $USER_TOKEN")"
check "payments require auth" 401 "$(code -X POST "$B/api/payments/start" -H 'Content-Type: application/json' -d '{"plan_id":1}')"

check "generate code" 201 "$(code -X POST "$B/api/admin/activation-codes/generate" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"user_id\":$USER_ID,\"plan_id\":$PLAN_ID,\"expires_in_days\":7}")"
ACT_CODE=$(field "d['item']['code']")
check "code format" "yes" "$(echo "$ACT_CODE" | grep -Eq '^TRD-[A-Z0-9]{4}-[A-Z0-9]{4}$' && echo yes || echo no)"
curl -s -o /tmp/body.json "$B/api/admin/activation-codes?status=unused" -H "Authorization: Bearer $ADMIN_TOKEN"
check "code list total" 1 "$(field "d['total']")"
check "code assigned user" "$USER_ID" "$(field "d['items'][0]['assigned_user_id']")"

# another user cannot use this code
code -X POST "$B/api/auth/signup" -H 'Content-Type: application/json' -d '{"full_name":"Second User","username":"seconduser","email":"second@example.com","password":"secret123","confirm_password":"secret123"}' >/dev/null
SECOND_TOKEN=$(field "d['token']")
check "foreign code rejected" 403 "$(code -X POST "$B/api/auth/activate" -H "Authorization: Bearer $SECOND_TOKEN" -H 'Content-Type: application/json' -d "{\"activation_code\":\"$ACT_CODE\"}")"

# --- activation ---------------------------------------------------------
check "activate own code" 200 "$(code -X POST "$B/api/auth/activate" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d "{\"activation_code\":\"$ACT_CODE\"}")"
check "activated status" ACTIVE "$(field "d['user']['account_status']")"
check "plan attached" "$PLAN_ID" "$(field "d['user']['active_plan_id']")"
check "activation code stored" "$ACT_CODE" "$(field "d['user']['activation_code_used']")"
check "reuse rejected" 409 "$(code -X POST "$B/api/auth/activate" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d "{\"activation_code\":\"$ACT_CODE\"}")"
check "unknown code" 404 "$(code -X POST "$B/api/auth/activate" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d '{"activation_code":"TRD-AAAA-BBBB"}')"

# analyze now passes the gate (Gemini itself fails with the dummy key, so expect 5xx, not 403)
ANALYZE_CODE=$(code -X POST "$B/api/analyze-chart" -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' -d "{\"imageBase64\":\"$(python3 -c 'print("A"*400)')\"}")
check "analyze passes activation gate" "yes" "$([ "$ANALYZE_CODE" != "403" ] && [ "$ANALYZE_CODE" != "401" ] && echo yes || echo no)"

# --- plans CRUD ---------------------------------------------------------
check "create plan" 201 "$(code -X POST "$B/api/admin/plans" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"name":"VIP Plan","plan_type":"PAID","price":99.5,"duration_days":90,"description":"VIP","features":["A","B"],"is_active":true}')"
NEW_PLAN=$(field "d['item']['id']")
check "plan price" 99.5 "$(field "d['item']['price']")"
check "update plan" 200 "$(code -X PUT "$B/api/admin/plans/$NEW_PLAN" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"price":79,"is_active":false}')"
check "plan updated price" 79 "$(field "d['item']['price']")"
check "inactive plan flag" "False" "$(field "d['item']['is_active']")"
check "delete unused plan" 200 "$(code -X DELETE "$B/api/admin/plans/$NEW_PLAN" -H "Authorization: Bearer $ADMIN_TOKEN")"
check "delete referenced plan blocked" 409 "$(code -X DELETE "$B/api/admin/plans/$PLAN_ID" -H "Authorization: Bearer $ADMIN_TOKEN")"

# --- user status --------------------------------------------------------
check "suspend user" 200 "$(code -X PUT "$B/api/admin/users/$USER_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"account_status":"SUSPENDED"}')"
check "suspended login blocked" 403 "$(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"identifier":"trader@example.com","password":"secret123"}')"
check "reactivate user" 200 "$(code -X PUT "$B/api/admin/users/$USER_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"account_status":"ACTIVE"}')"
check "invalid status rejected" 400 "$(code -X PUT "$B/api/admin/users/$USER_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"account_status":"BANNED"}')"

# --- activities ---------------------------------------------------------
check "activities feed" 200 "$(code "$B/api/admin/activities?page_size=50" -H "Authorization: Bearer $ADMIN_TOKEN")"
check "has activation activity" "yes" "$(field "'yes' if any(i['action']=='ACTIVATED' for i in d['items']) else 'no'")"
check "has signup activity" "yes" "$(field "'yes' if any(i['action']=='SIGNUP' for i in d['items']) else 'no'")"
check "has login activity" "yes" "$(field "'yes' if any(i['action']=='LOGIN' for i in d['items']) else 'no'")"
check "activity has username" "yes" "$(field "'yes' if all(i['username'] for i in d['items'] if i['action']=='SIGNUP') else 'no'")"

# --- delete user --------------------------------------------------------
check "delete user" 200 "$(code -X DELETE "$B/api/admin/users/$USER_ID" -H "Authorization: Bearer $ADMIN_TOKEN")"
check "deleted user login fails" 401 "$(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"identifier":"trader@example.com","password":"secret123"}')"
check "old token rejected" 401 "$(code "$B/api/auth/me" -H "Authorization: Bearer $USER_TOKEN")"

echo "----------------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
echo "--- server log ---"
tail -n 20 /tmp/backend-smoke.log
[ "$FAIL" -eq 0 ]
