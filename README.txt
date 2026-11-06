VEXERO+ v3.1 - Cloud (Render) + Movies on your own PC
=====================================================

KAISE KAAM KARTA HAI
  Viewer -> Render (website, catalog, profiles, admin)  ->  Movie ka signed link  ->  Tumhara PC (Media Node)
  * Movies kabhi GitHub/Render par upload nahi hoti, sirf tumhare PC me rehti hain.
  * Movie tabhi chalti hai jab PC on ho aur START-MEDIA-NODE.bat chal raha ho.
  * API KEY: Render aur PC dono me same hoti hai. Bina key ke koi PC se movie nahi le sakta:
      - PC har movie link ko HMAC se verify karta hai (link 6 ghante me expire, file-specific).
      - /list aur register sirf key ke saath chalte hain.
    Key banao (PowerShell):  -join ((48..57)+(97..122) | Get-Random -Count 40 | % {[char]$_})

STEP 1 - GitHub
  git init && git add . && git commit -m "vexero" && git branch -M main
  git remote add origin https://github.com/<you>/vexero-plus.git && git push -u origin main
  (.gitignore se movies/, data/ aur node-config.json push nahi hote)

STEP 2 - Render
  Render > New > Blueprint > apni repo chuno (render.yaml auto-detect hoga)
  Environment me VEXERO_API_KEY = tumhari lambi key daalo. Deploy.
  FREE plan chalega: Render par disk nahi hoti, isliye server catalog/profiles/admin password ka backup
  tumhare PC (media-node/backup/) par rakhta hai aur restart ke baad wahi se wapas la leta hai.
  Isliye PC ka media node on hona chahiye. Site 15 min idle rehne par so jati hai: UptimeRobot / cron-job.org
  (free) se https://<render-url>/healthz ko har 5 minute ping karwao.

STEP 3 - PC par Media Node
  1. Node.js LTS + cloudflared install:  winget install Cloudflare.cloudflared
  2. START-MEDIA-NODE.bat chalao -> node-config.json khulega:
       RENDER_URL = tumhara Render URL, API_KEY = wahi key, MOVIES_DIR = jaha movies hain (jaise D:\Movies)
  3. Dobara chalao. "Render server se connect ho gaya" dikhna chahiye.
  (Tunnel ka URL har baar badalta hai - node apne aap Render ko bata deta hai.)

STEP 4 - Admin (SIRF TUMHARE PC PAR, online admin hai hi nahi)
  START-ADMIN-LOCAL.bat chalao -> http://localhost:3030/admin (sirf isi PC se khulta hai, LAN/internet se nahi).
  Pehli baar console me SETUP CODE dikhega, usse password banao.
  * Movies folder (node-config.json ka MOVIES_DIR) me file daalo -> Import, ya Admin > Upload (local = bahut fast).
  * Jo bhi save/publish karoge, 2-3 second me website (Render) par apne aap sync ho jata hai ([SYNC] message).
  * Admin kaam khatam -> us window ko band kar do. Website aur movies chalti rahengi
    (movies ke liye START-MEDIA-NODE.bat chalta rehna chahiye).
  * Render par /admin 404 deta hai - koi bahar se admin nahi khol sakta.

OPTIONS
  STREAM_MODE=proxy  -> video Render se hokar jayega (PC ka URL chhupa rahega, par Render bandwidth lagegi)
  PC ka fixed URL hai (named Cloudflare tunnel / domain)? node-config.json me PUBLIC_URL daalo.

LOCAL TEST (bina Render)
  set VEXERO_API_KEY=<key> & node server.js     (terminal 1)
  media-node me RENDER_URL=http://localhost:3030 & PUBLIC_URL=http://localhost:4040    (terminal 2)
