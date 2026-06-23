# Project Export Instructions

This directory contains chunks of the project export zip file.

## Combining the chunks

### On Linux/Mac:
```bash
cat chunk-*.bin > project-export.zip
```

### On Windows (PowerShell):
```powershell
Get-ChildItem -Path "chunk-*.bin" | Sort-Object Name | Get-Content -Encoding Byte -ReadCount 0 | Set-Content -Encoding Byte -Path "project-export.zip"
```

### On Windows (Command Prompt):
```cmd
copy /b chunk-*.bin project-export.zip
```

After combining, extract the zip file to get your project files.
