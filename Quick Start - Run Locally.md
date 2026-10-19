# E-Balik: Quick Start (run it on your computer)

Follow the steps in order and copy the commands exactly. You do not need to set up any database: E-Balik already has one, and the `.env` file you were given connects to it. The first time takes about 15 minutes, mostly waiting for downloads. After that, starting E-Balik takes less than a minute (see "Next time").

You need three things from the person who gave you this project:

1. The **E-Balik project folder**.
2. A file named **`.env`** (a settings file; it is private, so it is sent separately and is not in the folder).
3. An **email and password** to sign in with.

---

## Step 1. Install two programs (one time only)

1. **Node.js**: go to https://nodejs.org, download the **LTS** version, run the installer and click **Next** until it finishes.
2. **Python**: go to https://www.python.org/downloads, download **Python 3.13**, run the installer. **Important:** on the first screen, tick **Add python.exe to PATH**, then click **Install Now**.

Restart your computer, or at least close every terminal window, so that the new programs are found.

## Step 2. Put the `.env` file in the right place

1. Open the E-Balik project folder, then open the folder **Environment_Configs**, then the folder **backend**.
2. Copy the `.env` file you were given into that **backend** folder.

The full path ends with `Environment_Configs\backend\.env`. The file name starts with a dot and has no other ending. If the dot makes the file disappear on your computer, turn on "Show hidden files" in your file explorer.

## Step 3. Open a terminal in the project folder

**Windows:** open the E-Balik project folder in File Explorer, click the address bar at the top (where the folder path is), type `cmd` and press **Enter**. A black window opens.

**Mac:** right-click the folder in Finder and choose **New Terminal at Folder**.

Leave this window open. In the next steps, "the terminal" means this window.

Check that the programs are installed. Type each command and press **Enter**. Each should print a version number (Python should start with 3):

```bash
node --version
python --version
```

On Mac use `python3 --version`. If you see "not recognized" or "command not found", repeat Step 1 and restart the computer.

## Step 4. Install E-Balik (one time only)

Type these commands one by one in the terminal. After each one, wait until the cursor comes back before typing the next. **The first command can take about 5 minutes. This is normal.**

**Windows:**

```bash
npm install
cd Server
python -m venv venv
venv\Scripts\python -m pip install -r requirements.txt
cd ..
```

**Mac:**

```bash
npm install
cd Server
python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt
cd ..
```

Yellow lines that start with `npm warn` or `WARNING` are only notices. Everything is fine unless you see the word `ERROR` at the end.

## Step 5. Start E-Balik

You need **two terminal windows** open at the same time. Do not close them while you use E-Balik.

**Window 1 (the backend):** use the terminal from Step 3. Type:

Windows:

```bash
cd Server
venv\Scripts\python run.py
```

Mac:

```bash
cd Server
venv/bin/python run.py
```

Wait until you see the line `Server: http://localhost:5000`. Leave this window alone.

**Window 2 (the website):** open a **new** terminal in the same project folder (repeat Step 3 for a second window). Type:

```bash
npm run dev:frontend
```

Wait until you see `Local: http://localhost:5173/`. Leave this window alone too.

## Step 6. Open E-Balik

1. Open your web browser (Chrome or Edge).
2. Go to **http://localhost:5173**
3. Click **Log in** and sign in with the email and password you were given.

That is all. E-Balik is now running on your computer.

---

## Admin console (only if you were given an admin account)

The admin console needs one extra install and a third terminal.

1. In a **new** terminal in the project folder, type (one time only):

```bash
cd Admin/Frontend
npm install
```

2. Then start it (every time you want to use it):

```bash
npm run dev -- --port 8443
```

3. In the browser go to **http://localhost:5173/admin/** and sign in with the admin email and password.

---

## Next time (after the first setup)

Skip Steps 1, 2 and 4. Only do this:

1. Open a terminal in the project folder (Step 3) and run the backend (Step 5, Window 1).
2. Open a second terminal and run `npm run dev:frontend` (Step 5, Window 2).
3. Go to http://localhost:5173

To stop E-Balik, click each terminal window and press **Ctrl + C**, then close the windows.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "not recognized" or "command not found" for `node` or `python` | Repeat Step 1 (for Python, tick **Add python.exe to PATH**), restart the computer and open a new terminal. |
| `npm install` seems stuck | Wait: the first time it can take 5 minutes. |
| The page opens but nothing loads, or it says it cannot reach the server | Window 1 (the backend) is not running. Start it again (Step 5) and wait for `Server: http://localhost:5000`. |
| `Invalid API key` in Window 1 | The `.env` file is missing, in the wrong folder, or edited by mistake. Put the original file back in `Environment_Configs\backend` (Step 2) and restart Window 1 (press **Ctrl + C**, then run the command again). |
| "Port already in use" | E-Balik is already running in another window. Close that window, or restart the computer. |
| The login does not accept your password | Check the email and password you were given, typing them carefully. After several wrong tries the account is locked for a few minutes. |
| The browser shows a blank page | Check that Window 2 is still running and that you opened exactly `http://localhost:5173`. |

If you are still stuck, send the person who gave you the project a screenshot of the terminal windows and of the browser.
