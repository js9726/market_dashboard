# Wiki Submodule Deploy Key Setup

The pre-open and journal-close CI workflows mount your `trade-analyser_skill`
wiki repo as a submodule at `packages/core-skills/wiki-source/` so Claude can
read trader-style / risk-management / entry-method rules at generation time.

`trade-analyser_skill` is a PRIVATE repo, so GH Actions can't clone it with
the default `GITHUB_TOKEN`. Setup is one-time, ~3 min.

## Step 1: Generate an SSH keypair

On your PC, in PowerShell:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\wiki_deploy_key -C "market_dashboard CI" -N '""'
```

This creates two files:
- `~/.ssh/wiki_deploy_key`     (private — never commit)
- `~/.ssh/wiki_deploy_key.pub` (public — for GitHub)

## Step 2: Add the PUBLIC key as a Deploy Key on the wiki repo

```powershell
# Open the wiki repo's deploy-keys page
Start-Process "https://github.com/js9726/trade-analyser_skill/settings/keys/new"

# Print the public key to paste
Get-Content $env:USERPROFILE\.ssh\wiki_deploy_key.pub
```

In the GitHub UI:
1. Title: `market_dashboard CI`
2. Key: paste the public key contents
3. **DO NOT** check "Allow write access" (read-only is enough)
4. Click "Add key"

## Step 3: Add the PRIVATE key as a GH secret on the market_dashboard repo

```powershell
# Copy the private key to clipboard
Get-Content $env:USERPROFILE\.ssh\wiki_deploy_key | Set-Clipboard
Write-Host "Private key copied to clipboard."

# Open the secrets page
Start-Process "https://github.com/js9726/market_dashboard/settings/secrets/actions/new"
```

In the GitHub UI:
1. Name: `WIKI_SSH_KEY`
2. Value: paste the private key (the whole `-----BEGIN OPENSSH PRIVATE KEY-----` ... `-----END OPENSSH PRIVATE KEY-----` block)
3. Click "Add secret"

## Step 4: Update the workflow to use the deploy key

After the secret is set, replace the submodule-fetch step in
`.github/workflows/refresh_premarket.yml` (and `journal_close.yml`) with:

```yaml
      - name: Fetch wiki submodule via deploy key
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.WIKI_SSH_KEY }}

      - name: Init submodules
        run: git submodule update --init --recursive
```

Then remove the non-fatal fallback (the temporary `continue-on-error: true` block).

## Why a deploy key vs PAT / public repo?

- **Deploy key:** scoped to ONE repo (read-only). No write access, no spread.
- **PAT (personal access token):** has all your user's permissions (too broad).
- **Public repo:** simplest, but anyone can read your wiki (low risk for trader-style content, but data leak).

Deploy key is the principle-of-least-privilege answer.
