---
name: Bookmarks
cron: "0 8 * * *"
agent: build
action:
  type: script
  script:
    uses:
      - x.posts.get_users_bookmarks
    files:
      bookmarks:
        path: bookmarks.json
        mode: readwrite
        format: json
    code: |
      const page = await tools.x.posts.get_users_bookmarks({});
      return { count: (page.data ?? []).length };
---
