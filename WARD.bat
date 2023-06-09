@ECHO off

:Run
node .

ECHO %errorlevel%
IF errorlevel 1 GOTO Run

PAUSE