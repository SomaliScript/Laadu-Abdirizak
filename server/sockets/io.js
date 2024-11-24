module.exports = io => {
    io.on('connection', socket => {
        console.log('New socket connection');
        
        socket.on('move', function(source, target){
            io.emit('newMove', {
                from: source,
                to: target,
            });
        });
    });
}

