const http = require('http'),
      path = require('path'),
      express = require('express'),
      handlebars = require('express-handlebars'),
      socket = require('socket.io');

const config = require('../config');

const myIo = require('./sockets/io'),
      routes = require('./routes/routes');

const app = express(),
      server = http.Server(app),
      io = socket(server);

// Ensure the server listens on all network interfaces (0.0.0.0)
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Server listening on port ${config.port}`);
});

// Optional: Add error handling for the server
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1); // Exit the process with an error
});

games = {};

myIo(io);

// Configure Handlebars
const HandlebarsEngine = handlebars.create({
  extname: '.html', 
  partialsDir: path.join(__dirname, '..', 'front', 'views', 'partials'), 
  defaultLayout: false,
  helpers: {}
});
app.engine('html', HandlebarsEngine.engine);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, '..', 'front', 'views'));
app.use('/public', express.static(path.join(__dirname, '..', 'front', 'public')));

// Set up routes
routes(app);