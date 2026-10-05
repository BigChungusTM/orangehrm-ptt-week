# PTT Week for OrangeHRM

A self-contained weekly attendance planner for OrangeHRM. Paint working time in 30-minute cells, copy Monday across the week, or erase cells; then press **Save** and confirm the summary. The tool reads each day before changing it, applies requests in order, and reads the result back. It supports creating, editing, and deleting completed same-day attendance records.

## Install in Chrome or Edge

1. Create a bookmark/favourite named **PTT Week**.
2. Copy the entire contents of [bookmarklet.txt](bookmarklet.txt) into its **URL** field. It begins with `javascript:`.
3. Open your signed-in OrangeHRM tab and click that bookmark.

The bookmarklet runs in the current OrangeHRM tab using your existing session. It needs no extension, password, server, or external script. If your browser or organisation blocks bookmarklets, follow its policy; a DevTools Snippet can use [the same JavaScript source](orangehrm-ptt-week.js) where permitted.

## Use

Select the week, paint or erase time, and use **Copy Monday → Tue–Fri** or **Clear week** as needed. Press **Save**, review the concise confirmation, and check the saved-day count beside the week total. A failed day stops further writes and shows the server error and actual records.

This was developed against an OrangeHRM OS 5.7 deployment; other versions or custom deployments may use different attendance APIs. Check one day in OrangeHRM before relying on a full-week save. The grid covers Monday–Friday, 06:00–22:00, in 30-minute cells. London GMT/BST offsets are calculated for each date.

To regenerate `bookmarklet.txt` after editing the source, run `python3 build-bookmarklet.py`.

This is an independent community tool and is not affiliated with OrangeHRM. OrangeHRM Starter is [open source](https://github.com/orangehrm/orangehrm); this tool has its own [MIT license](LICENSE).
