# Ship garden: package src/ → DEPLOY/, sync s3://aether.garden/, invalidate aether.garden.
# Leaves the axiom/ prefix alone. Axiom ships with deploy-axiom.ps1.
# Requires AWS CLI (us-east-1 bucket). Run from repo root:
#   .\deploy-live.ps1

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Deploy = Join-Path $Root 'DEPLOY'

Push-Location (Join-Path $Root 'src')
npm run package
Pop-Location

$js = Get-ChildItem $Deploy -Filter '*.js' -File | ForEach-Object { $_.Name }
$main = ($js | Where-Object { $_ -match '^main-.+\.js$' } | Select-Object -First 1)
$worker = ($js | Where-Object { $_ -match '^sim\.worker-.+\.js$' } | Select-Object -First 1)
$forge = ($js | Where-Object { $_ -match '^forge-.+\.js$' } | Select-Object -First 1)
if (-not $main -or -not $worker -or -not $forge) {
  throw "DEPLOY missing main/worker/forge bundles (run npm run package in src/)"
}

$cc = 'public, max-age=31536000, immutable'
$ct = 'text/javascript'

# axiom/ stays for axiom.aether.garden. assets/ and the three live bundles are
# synced below with the immutable header. Excluding them here keeps --delete
# from dropping the current ones while still removing retired bundle names.
Write-Host "Sync DEPLOY → s3://aether.garden/ (no-cache, skip axiom/ and hashed files)…"
aws s3 sync $Deploy s3://aether.garden/ --delete `
  --exclude "axiom/*" --exclude "assets/*" --exclude $main --exclude $worker --exclude $forge `
  --cache-control "no-cache" --region us-east-1

# Content hash is in the key, so same size means same bytes. New keys upload
# once with the immutable header; unchanged keys are left alone.
Write-Host "Sync hashed assets (immutable, skip unchanged)…"
aws s3 sync (Join-Path $Deploy 'assets') "s3://aether.garden/assets/" --size-only --delete --cache-control $cc --region us-east-1

foreach ($f in @($main, $worker, $forge)) {
  $local = Join-Path $Deploy $f
  $size = (Get-Item $local).Length
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $meta = aws s3api head-object --bucket aether.garden --key $f --region us-east-1 --output json 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $same = $false
  if ($code -eq 0 -and $meta) {
    $obj = $meta | ConvertFrom-Json
    $same = ($obj.ContentLength -eq $size -and $obj.CacheControl -eq $cc)
  }
  if ($same) {
    Write-Host "  unchanged: $f"
  } else {
    Write-Host "  immutable cache: $f"
    aws s3 cp $local "s3://aether.garden/$f" --cache-control $cc --content-type $ct --region us-east-1
  }
}

# aether.garden + www. axiom.aether.garden is deploy-axiom.ps1.
aws cloudfront create-invalidation --distribution-id E16NES5CQO1ZJ8 --paths '/*' | Out-Null
Write-Host "CloudFront invalidation /* on E16NES5CQO1ZJ8"

Write-Host "Done - bundles: $main, $worker, $forge"
