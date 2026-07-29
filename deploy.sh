#!/bin/bash
# AI Pulse 资讯中心 - 部署脚本
# 使用已保存的 Netlify 配置

TOKEN="nfp_qdzaGCgpygk2NQAQC9qbFi6zJGxeTamA6d61"
SITE_ID="82e2d9a7-95a2-48d0-99a6-7b76799542f1"
SITE_URL="https://glittering-croquembouche-1d5886.netlify.app"

echo "============================================"
echo "  AI Pulse 资讯中心 · 部署工具"
echo "============================================"
echo ""

# 打包部署
cd "$(dirname "$0")/deploy"
rm -f /tmp/deploy.zip
zip -j /tmp/deploy.zip index.html

echo ">>> 部署到 Netlify..."
DEPLOY=$(curl -s -X POST "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @/tmp/deploy.zip)

STATE=$(echo "$DEPLOY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('state',''))" 2>/dev/null)
echo ">>> 状态: $STATE"

if [ "$STATE" = "ready" ] || [ "$STATE" = "uploaded" ]; then
  echo ""
  echo "✅ 部署成功！"
  echo "   访问地址: $SITE_URL"
else
  echo "❌ 部署异常，请检查 token 是否有效"
fi
