param([string]\='update')

git add -A
if (-not (git diff --cached --quiet)) {
  git commit -m \
  git push
} else {
  Write-Host 'No changes to commit.'
}

