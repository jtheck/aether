# Ship axiom only: src/axiom/ → s3://aether.garden/axiom/
# Invalidates axiom.aether.garden, and /axiom/* on aether.garden (soft landing + /axiom link).
# Requires AWS CLI (us-east-1 bucket). Run from repo root:
#   .\deploy-axiom.ps1

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Axiom = Join-Path $Root 'src\axiom'

if (-not (Test-Path (Join-Path $Axiom 'index.html'))) {
  throw "src/axiom/index.html missing"
}

Write-Host "Sync src/axiom → s3://aether.garden/axiom/ (no-cache)…"
aws s3 sync $Axiom s3://aether.garden/axiom/ --delete --cache-control "no-cache" --region us-east-1

# Subdomain origin path is /axiom, so /* is that tree.
aws cloudfront create-invalidation --distribution-id E14MZ80C43O782 --paths '/*' | Out-Null
Write-Host "CloudFront invalidation /* on E14MZ80C43O782 (axiom.aether.garden)"

# Same objects also serve aether.garden/axiom (WebGPU soft landing and the about link).
aws cloudfront create-invalidation --distribution-id E16NES5CQO1ZJ8 --paths '/axiom/*' | Out-Null
Write-Host "CloudFront invalidation /axiom/* on E16NES5CQO1ZJ8"

Write-Host "Done - axiom"
