# Ship web: package src/ → DEPLOY/, sync s3://aether.garden/, invalidate CloudFront.
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

Write-Host "Sync DEPLOY → s3://aether.garden/ (no-cache default)…"
aws s3 sync $Deploy s3://aether.garden/ --delete --cache-control "no-cache" --region us-east-1

$cc = 'public, max-age=31536000, immutable'
$ct = 'text/javascript'
foreach ($f in @($main, $worker, $forge)) {
  Write-Host "  immutable cache: $f"
  aws s3 cp (Join-Path $Deploy $f) "s3://aether.garden/$f" --cache-control $cc --content-type $ct --region us-east-1
}

# aether.garden + www; axiom.aether.garden (same origin)
foreach ($id in @('E16NES5CQO1ZJ8', 'E14MZ80C43O782')) {
  aws cloudfront create-invalidation --distribution-id $id --paths '/*' | Out-Null
  Write-Host "CloudFront invalidation /* on $id"
}

Write-Host "Done — bundles: $main, $worker, $forge"
