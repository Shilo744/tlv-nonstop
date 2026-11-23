@echo off
rem TLV NONSTOP - start the local server and open the game in the default browser.
cd /d "%~dp0"
start "" http://127.0.0.1:8080/
node serve.mjs 8080
