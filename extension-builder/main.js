const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function createWindow() {
	const window = new BrowserWindow({
		width: 1080,
		height: 760,
		minWidth: 760,
		minHeight: 640,
		backgroundColor: "#0f0f13",
		autoHideMenuBar: true,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	window.loadFile(path.join(__dirname, "index.html"));
}

function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (character) => {
		const entities = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[character];
	});
}

ipcMain.handle("create-extension", async (event, details) => {
	const name = String(details?.name || "").trim();
	const id = String(details?.id || "").trim();
	const version = String(details?.version || "").trim();

	if (!name || name.length > 60) {
		throw new Error("Escribe un nombre de entre 1 y 60 caracteres.");
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
		throw new Error("El identificador solo puede contener letras, números y guiones.");
	}
	if (!/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error("La versión debe tener el formato 1.0.0.");
	}

	const parent = BrowserWindow.fromWebContents(event.sender);
	const selection = await dialog.showOpenDialog(parent, {
		title: "Elige dónde crear la extensión",
		defaultPath: app.getPath("documents"),
		properties: ["openDirectory", "createDirectory"],
	});
	if (selection.canceled || selection.filePaths.length === 0) return null;

	const root = path.join(selection.filePaths[0], id);
	const archivePath = path.join(
		selection.filePaths[0],
		`${id}.v3.stormbrowser.extension`,
	);
	if (fs.existsSync(root) || fs.existsSync(archivePath)) {
		throw new Error("Ya existe una carpeta o extensión con ese identificador en el destino.");
	}
	await fs.promises.mkdir(root);

	const manifest = {
		extension: {
			name,
			id,
			version: `v${version}`,
			index: "extension.loader",
			fileSorces: "extension.soruces",
		},
		loader: {
			"version-loader": "v1",
			type: "general",
		},
		url: {
			web1: "",
			web2: "",
		},
	};
	const manifestContents = JSON.stringify(manifest, null, 2);
	const safeName = escapeHtml(name);
	const files = {
		"extension-file.info": manifestContents,
		"extension.json": manifestContents,
		"extension.loader":
			'startUp: "index.html", "javascript/script.js";\n' +
			'iconExtension: "source";\n' +
			"source: src;\nimages: images;\naudio: audio;\nvideo: video;\n",
		"extension.soruces": "source: src;\nimages: images;\naudio: audio;\nvideo: video;\n",
		"src/index.html": `<!doctype html>
<html lang="es">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${safeName}</title>
		<link rel="stylesheet" href="style/style.css" />
	</head>
	<body>
		<main>
			<h1>${safeName}</h1>
			<p>Tu extensión de StormBrowser ya está lista para empezar.</p>
		</main>
		<script src="javascript/script.js"></script>
	</body>
</html>
`,
		"src/javascript/script.js": 'console.log("Extensión iniciada");\n',
		"src/style/style.css": `body {
	margin: 0;
	min-height: 100vh;
	display: grid;
	place-items: center;
	background: #0f0f13;
	color: #e8e8f0;
	font-family: Arial, sans-serif;
}

main {
	text-align: center;
}

h1 {
	color: #6c8fff;
}
`,
	};

	await Promise.all(
		[
			"src/javascript",
			"src/style",
			"src/images",
			"src/audio",
			"src/video",
			"src/text",
		].map((directory) =>
			fs.promises.mkdir(path.join(root, directory), { recursive: true }),
		),
	);
	await Promise.all(
		Object.entries(files).map(([file, contents]) =>
			fs.promises.writeFile(path.join(root, file), contents, "utf8"),
		),
	);

	const sevenZipPath = path.join(__dirname, "extraFiles", "7zip", "7za.exe");
	try {
		await execFileAsync(
			sevenZipPath,
			["a", "-tzip", "-mx=9", archivePath, id],
			{ cwd: selection.filePaths[0], windowsHide: true },
		);
	} catch {
		throw new Error(`No se pudo empaquetar. El proyecto fuente está en ${root}.`);
	}

	return { folder: root, archive: archivePath };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
