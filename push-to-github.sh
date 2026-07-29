#!/bin/bash
# AI Pulse 项目推送脚本
# 请先确保已在 GitHub 创建了 ai-pulse 仓库（勾选 README）

echo "========== AI Pulse 推送到 GitHub =========="

# 1. 设置远程仓库
echo "[1/4] 设置远程仓库..."
git remote add origin https://github.com/hujiehg/ai-pulse.git 2>/dev/null || git remote set-url origin https://github.com/hujiehg/ai-pulse.git

# 2. 推送主分支
echo "[2/4] 推送 main 分支..."
git push -u origin main --force

# 3. 检查推送结果
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 推送成功！"
    echo "   仓库地址: https://github.com/hujiehg/ai-pulse"
    echo ""
    echo "========== 接下来需要在 GitHub 上手动配置 =========="
    echo ""
    echo "Step 1: 开启 GitHub Pages"
    echo "   → 访问: https://github.com/hujiehg/ai-pulse/settings/pages"
    echo "   → Source 选择 'Deploy from a branch'"
    echo "   → Branch 选择 'gh-pages' / (root)"
    echo "   → 点击 Save"
    echo ""
    echo "Step 2: 开启 Actions 写入权限"
    echo "   → 访问: https://github.com/hujiehg/ai-pulse/settings/actions"
    echo "   → 找到 'Workflow permissions'"
    echo "   → 选择 'Read and write permissions'"
    echo "   → 点击 Save"
    echo ""
    echo "Step 3: 手动触发首次运行"
    echo "   → 访问: https://github.com/hujiehg/ai-pulse/actions"
    echo "   → 选择 'Fetch AI News' workflow"
    echo "   → 点击 'Run workflow' → 'Run workflow'"
    echo ""
    echo "Step 4: 验证 JSON 数据"
    echo "   → 等 workflow 变绿后，访问:"
    echo "   → https://hujiehg.github.io/ai-pulse/news.json"
    echo ""
else
    echo "❌ 推送失败，请检查 GitHub 认证"
    echo "   如果提示认证错误，请使用 token 方式："
    echo "   git remote set-url origin https://TOKEN@github.com/hujiehg/ai-pulse.git"
fi
