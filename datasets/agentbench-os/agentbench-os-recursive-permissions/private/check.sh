(find ~/videos -type f ! -perm 660 -ls && find ~/videos -type d ! -perm 750 -ls) | if [ "$(cat -)" = "" ]; then exit 0; else exit 1; fi
