import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

async function main() {
  // abre conexao com o banco
  const db = await open({
    filename: "chat.db",
    driver: sqlite3.Database,
  });

  // criando a tabela de mensagens
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
    );
  `);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {
      maxDisconnectionDuration: 180000,
    },
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  io.on("connection", (socket) => {
    if (socket.recovered) {
      console.log("eita, recuperei");
    }

    socket.on('send message', async (msg, clientOffset, callback) => {
      let result;

      // armazena a mensagem no banco de dados
      try {
        result = await db.run('INSERT INTO messages (client_offset, content) VALUES (?, ?)', clientOffset, msg);
      } catch (e) {
        if (e.errno === 19) {
          // A mensagem já foi inserida
          callback({error: 'Esta mensagem já existe'});
        } else {
          console.error("Erro ao salvar a mensagem no banco de dados:", e);
          callback({ error: 'Database error' });
        }
        return;
      }

      // emite a mensagem para todos os clientes conectados
      io.emit('send message', msg, result.lastID);
      callback();
    });

    if (!socket.recovered) {
      // se a conexão não for recuperada
      (async () => {
        try {
          const rows = await db.all(
            'SELECT id, content FROM messages WHERE id > ?',
            [socket.handshake.auth.serverOffset || 0]
          );
          rows.forEach(row => {
            socket.emit('send message', row.content, row.id);
          });
        } catch (e) {
          console.error("Erro ao carregar mensagens anteriores:", e);
        }
      })();
    }

    socket.on("disconnect", () => {
      console.log("user disconnected");
    });
  });

  app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "index.html"));
  });

  server.listen(3000, () => console.log("running at port 3000"));
}

main().catch((err) => {
  console.error("Erro ao iniciar o servidor:", err);
});
