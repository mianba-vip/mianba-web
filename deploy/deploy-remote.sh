#!/usr/bin/env bash
# 在前端机执行；配置失败或健康检查失败时恢复旧站点与旧配置。
set -Eeuo pipefail
DEPLOY_DIR="${1:?deploy dir}"
RELEASE_ID="${2:?release id}"
EXPECTED_JS="${3:?asset path}"
[[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$DEPLOY_DIR" != / &&
   ! "$DEPLOY_DIR" =~ (^|/)\.\.(/|$) ]] || exit 1
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9-]+$ ]] || exit 1
STAGE="$DEPLOY_DIR/releases/$RELEASE_ID"
CONFIG=/etc/nginx/conf.d/mianba-web.conf
OLD_TARGET="$(readlink "$DEPLOY_DIR/current" || true)"
HAD_CONFIG=false
[[ ! -f "$CONFIG" ]] || { cp -a "$CONFIG" "$STAGE/.deploy/nginx.previous"; HAD_CONFIG=true; }
rollback() {
  local rc=$?
  trap - ERR
  if [[ -n "$OLD_TARGET" ]]; then
    ln -s "$OLD_TARGET" "$DEPLOY_DIR/.rollback-$RELEASE_ID"
    mv -Tf "$DEPLOY_DIR/.rollback-$RELEASE_ID" "$DEPLOY_DIR/current"
  else
    rm -f -- "$DEPLOY_DIR/current"
  fi
  if [[ "$HAD_CONFIG" == true ]]; then
    cp -a "$STAGE/.deploy/nginx.previous" "$CONFIG"
  else
    rm -f -- "$CONFIG"
  fi
  nginx -t && systemctl reload nginx || true
  echo "DEPLOY_FAILED: 已恢复旧站点；失败版本保留于 $STAGE" >&2
  exit "$rc"
}
trap rollback ERR
test -s "$STAGE/index.html"
test -s "$STAGE/app/index.html"
test -s "$STAGE/app/$EXPECTED_JS"
openssl x509 -in "$DEPLOY_DIR/certs/mianba.vip.pem" -noout -checkend 604800
systemctl is-active --quiet mianba-backend-tunnel
curl -fsS --max-time 15 http://127.0.0.1:23333/healthz >/dev/null
chmod -R a+rX "$STAGE"
chmod 755 "$DEPLOY_DIR" "$DEPLOY_DIR/releases"
ln -s "$STAGE" "$DEPLOY_DIR/.current-$RELEASE_ID"
mv -Tf "$DEPLOY_DIR/.current-$RELEASE_ID" "$DEPLOY_DIR/current"
sed "s|__DEPLOY_DIR__|$DEPLOY_DIR|g" "$STAGE/.deploy/nginx.conf" > "$CONFIG"
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx
# 校验真实域名与证书，不使用 -k。
for ((attempt=1; attempt<=10; attempt++)); do
  if curl -fsS --max-time 10 --resolve mianba.vip:443:127.0.0.1 \
      https://mianba.vip/app/ | grep -Fq "$EXPECTED_JS"; then break; fi
  sleep 1
done
curl -fsS --max-time 15 --resolve mianba.vip:443:127.0.0.1 https://mianba.vip/app/ | grep -F "$EXPECTED_JS" >/dev/null
for path in / /actuator/health /api/auth/config "/app/$EXPECTED_JS"; do
  curl -fsS --max-time 20 --resolve mianba.vip:443:127.0.0.1 "https://mianba.vip$path" >/dev/null
done
if [[ -n "$OLD_TARGET" ]]; then
  ln -s "$OLD_TARGET" "$DEPLOY_DIR/.previous-$RELEASE_ID"
  mv -Tf "$DEPLOY_DIR/.previous-$RELEASE_ID" "$DEPLOY_DIR/previous"
fi
trap - ERR
echo "DEPLOY_OK: $RELEASE_ID"
