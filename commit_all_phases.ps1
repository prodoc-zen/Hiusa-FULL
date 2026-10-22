# ==============================================================================
# Forwarding execution into the dedicated hiusa-v2 git repository
# Target Repo: https://github.com/Jadehaerys/hiusa-v2.git
# ==============================================================================

Set-Location -Path "hiusa-v2"
& ".\commit_all_phases.ps1"
Set-Location -Path ".."
