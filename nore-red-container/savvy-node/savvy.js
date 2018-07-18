module.exports = function (RED) {
    "use strict";

    var crypto = require("crypto");
	
	// Uses for the Cloud API
    var https = require('https');
	
	// Used for the Local (RestStreaming)
	var http = require('http');
	
	// Almacena la request que se está ejecutando en un momento dado. Al ser una variable global se puede parar en cualquier momento desde cualquier punto
	var request = null;

    function savvyNode(n) {
        // Create a RED node
        RED.nodes.createNode(this, n);

        // Store local copies of the node configuration (as defined in the .html)
        this.topic = n.topic;
        this.endpoint = n.endpoint;
        this.returntype = n.returntype;
        this.apitype = n.apitype;
        this.port = n.port;
        this.key = n.key;
        this.secret = n.secret;
        this.target = n.target;
        this.locationId = n.locationId;
        this.machineId = n.machineId;
        this.groupId = n.groupId;
		this.indicatorId = n.indicatorId;
		this.fromTs = n.fromTs;
		this.toTs = n.toTs;
		this.cncmanufacturer = n.cncmanufacturer;
		
		// The flag that indicates the status of the stream. true = Stream is running / false = stream is stopped
		this.streamStatus = false;

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        // respond to inputs....
        this.on('input', function (msg_input) {
			
			console.log("Input received, node running");
			
			// Check if a STOP message was send. A stop message must stop any live request
			if (msg_input.stopRequest !== undefined && msg_input.stopRequest) 
			{
				console.log("Stop request received");
				// Stop any live request
				if (request != null)
				{
					request.abort();
					request.end();
					console.log("Request stopped");
				}
				else {
					console.log("There is not request to stop");
				}
				return;
			}			
			
            var method = computeEndpoint(node, msg_input);
			
			if (typeof msg_input.streamStatus !== 'undefined'){
				node.streamStatus = msg_input.streamStatus;
				console.log(node.streamStatus);
			}

			console.log("Calling sendRequest");
			sendRequest(msg_input, method, node, function (res) // , statusCode); 
			{					
				console.log("Callback sendRequest");
				// BUG - No se puede crear otro mensjae, si se hace, el original se pierde y puede que tenga elementos que se necesiten en los siguietnes nodos
				//var msg = {};
				switch(node.returntype) {
					case "utf-8":
						console.log("Setting the payload as utf-8 string");
						msg_input.payload = res;
						break;
					case "json":						
						console.log("Setting the payload as JSON object");						
						// TODO posible error SyntaxError: Unexpected end of JSON input
						//try {
						msg_input.payload = JSON.parse(res);
							
						//} catch(err) {
							// Sabemos que cuando se para el stream puede dar este error 							
							//console.log(err.toString());
						//}
						
						// AITOR TODO - poner un campo más con el código de estado recogido?
						// msg_input.statusCode = statusCode;
						break;
				}

				console.log("Calling node.send");
				// Send the CNC manufacturer as msg parameter
				msg_input.cncmanufacturer = node.cncmanufacturer;
				node.send(msg_input);
				console.log("Done: savvyNode input management finished");
			});
		});

        this.on("close", function () {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: node.client.disconnect();
			// TODO mirar si esto salta cunado desconectamos el cable de la caja
        });
    }

	// AITOR este método debe permitir computar el endpotin a partir de parámetros dados en el propio mensaje de entrada
    function computeEndpoint(node, msg) {
        var ep = "";
		
		// Computar los valores de estos parámetros en función de si han sido dados en el mensaje de entrada o no
		var machineId = node.machineId;
		var locationId = node.locationId;
		var groupId = node.groupId;
		var indicatorId = node.indicatorId;
		var fromTs = node.fromTs;
		var toTs = node.toTs;
		// Override the node properties with those set in the message
		if (msg.machineId !== undefined) machineId = msg.machineId; // machinesId podría ser una lista separada por coma en caso de llamadas a /stream
		if (msg.locationId !== undefined) locationId = msg.locationId;
		if (msg.groupId !== undefined) groupId = msg.groupId;
		if (msg.indicatorId !== undefined) indicatorId = msg.indicatorId;
		if (msg.fromTs !== undefined) fromTs = msg.fromTs;
		if (msg.toTs !== undefined) toTs = msg.toTs;
		
		console.log("machineId: " + machineId);
		console.log("locationId: " + locationId);
		console.log("groupId: " + groupId);
		console.log("indicatorId: " + indicatorId);
		
		if (node.apitype === 'cloud')
		{
			switch(node.target)
			{
				case "stream":
					ep += "/v1/stream?track=" + machineId;
					break;
				case "data":					
					ep += "/v1/locations/" + locationId + "/machines/" + machineId
					if (groupId) ep+= "/groups/" + groupId
					if (indicatorId) ep+= "/indicators/" + indicatorId;
					ep += "/data?from=" + fromTs + "&to=" + toTs;
					break;
				case "list-machines":
					ep += "/v1/locations/" + locationId + "/machines";
					break;
				case "list-indicators":
					ep += "/v1/locations/" + locationId + "/machines/" + machineId + "/groups/" + groupId + "/indicators";
					break;
				case "list-capture-groups":
					ep += "/v1/locations/" + locationId + "/machines/" + machineId + "/groups";
					break;
				case "list-locations":
				default:
					ep += "/v1/locations/";
					break;
				case "details-machine":
					ep += "/v1/locations/" + locationId + "/machines/" + machineId;
					break;
				case "details-indicator":
					ep += "/v1/locations/" + locationId + "/machines/" + machineId + "/groups/" + groupId + "/indicators/" + indicatorId;
					break;
				case "details-capture-group":
					ep += "/v1/locations/" + locationId + "/machines/" + machineId + "/groups/" + groupId;
					break;
				case "details-location":
					ep += "/v1/locations/" + locationId
					break;
			}
		}
		else if (node.apitype === 'local')
		{
			switch(node.target)
			{
				case "stream":
					ep += "/stream?machines=" + machineId;
					break;
				case "details-indicator":
					ep += "/indicators";
					break;
			}
		}
		
        return ep;
    }

    function sendRequest(msg, path, node, callback) {
        var epoch = new Date().getTime();
        var auth = generateAuthorization(path, epoch, node.key, node.secret);
		
		switch(node.apitype) 
		{
			case "cloud":
				console.log("apitype is: cloud");
				var options = {
					host: node.endpoint,
					path: path,
					method: "GET",
					"headers": {
						"Content-Type": "text/plain; charset=UTF-8",
						"X-M2C-Sequence": epoch,
						"Authorization": auth
					}
				};
				console.log("Request options generated");
				console.log("Host: " + node.endpoint);
				console.log("Path: " + path);
				console.log("X-M2C-Sequence: " + epoch);
				console.log("Authorization: " + auth);
				console.log("Requesting...");

				// Uses HTTPS. Request es una variable global
				request = https.request(options, function (response) {

					var str = ''
					response.on('data', function (chunk) { 

						console.log("Response on DATA fired");

						// If we are streaming , we return the chunk itself as the full response is in one chunk
						if (node.target === "stream")
						{
							console.log("The callback is a stream, responding");
							// The '' + chunk is added to convert the buffer into a string, and 
							var chunkedData = '' + chunk;														
							var chunkParts = chunkedData.split("\r\n");
							var responseString = "";
							
							// The first line can be: 1.- The number of bytes to read in the nextline; 2.- An JSON with an error message
							var re = new RegExp('^[0-9]+$');
							if (re.test(chunkParts[0])) // If the line is a number, get the next line if it is not a heartbeat
							{ 
								if (chunkParts[0] == "0") // heartbeat
									responseString = "";
								else
									responseString = chunkParts[1];
							}
							else
							{
								// It is not a number, strange, print the error
								responseString = chunkParts[0];
							}
							callback(responseString);
						}					
						else
						{
							// Si no es un stream, concatenar todos los posibles chunks y se response en el evento END más abajo
							// Esto pasará en llamadas a /data, donde la respuesta puede ser muy larga.
							// TODO, cuidado! Aquí nosotros hacemos join y no respondemos por chunks sino todo en uno. Podría petar? Deberíamos respetar los chunks y mandar un msj cada vez
							console.log("The callback is not a stream, joining chunks to respond");
							str += chunk;
						}					
					});

					// We get to here if the request ends or the request is stopped
					// TODO si la request se para siempre se response una última vez. No pasa nada pero es raro.
					// Si cambiamos la concatenación de chunks y única respuesta final por ir respondiendo chunk a chunk, aquí solo entraríamos
					// con el stop, y ya no haría falta llamar al callback.
					response.on('end', function () {
						console.log("Response on END fired");						
						// si es un stream, no llamamos al callback porque estamos simplemente parando la petición
						// Solo se le llama enpeticiones no stream, que es donde se mandan datos al finalizar la petición a la API
						if (node.target !== "stream") {
							console.log("Calling the callback with the response received");		
							callback(str);
						}
						else 
							console.log('No se llama al callback porque la petición es de tipo stream');
					});

					response.on('error', function (e) {
						// TODO devolver el error, no se siquiera si e es un string o un objeto, si es un obj esto no printa el error
						// AITOR TODO gestionar aquí códigos de estado, 
						console.log("Response error: " + e)
						console.log(e);
					});
				});
				break;
				
			// Local restStreaming requires a port and doesn't need extra headers
			case "local":
				var options = {
					host: node.endpoint,
					port: node.port,
					path: path,
					method: "GET",
					"headers": {
						"Content-Type": "text/plain; charset=UTF-8"
					}
				};
				
				// Uses HTTP. Request es una variable global
				request = http.request(options, function (response) {

					var str = ''
					response.on('data', function (chunk) 
					{
						
						// If we are streaming , we return the chunk itself as the full response is in one chunk
						if (node.target === "stream")
						{
							console.log("response.on(data): Lanzado");						
							
							try {
								// The '' + chunk is added to convert the buffer into a string
								var responseString = '' + chunk;
								
								// Modify the line breaks to get always a "\r\n"
								var responseArray = responseString.replace("\r", "").replace("\n", "\r\n").split("\r\n")
								
								// Send callback for each line
								responseArray.forEach(function(el) {
									callback(el);
								});
								
							} catch(ex) {
								// When an empty string comes do nothing
								// Este captura el error que se recib del JSON.load() del callbak sendRequest
								console.log("Recibidos datos vacíos, no se llama al callback sendRequest"); // TODO estamos asumiendo mucho
							}
						}
						else
						{
							// No es un stream, asignamos el chunk (la respuesta total ya que aquí no hay chunk como tal) al str
							console.log("The callback is not a stream, joining chunks to respond");
							str += chunk;
						}
			
					});

					// if the request is stopped
					response.on('end', function () {
						console.log("Response on END fired");						
						// si es un stream, no llamamos al callback porque estamos simplemente parando la petición
						// Solo se le llama enpeticiones no stream, que es donde se mandan datos al finalizar la petición a la API
						if (node.target !== "stream") {
							console.log("Calling the callback with the response received");		
							callback(str);
						}
						else 
							console.log('No se llama al callback porque la petición es de tipo stream');
					});

					response.on('error', function (e) {
						// TODO devolver el error, no se siquiera si e es un string o un objeto, si es un obj esto no printa el error
						console.log("Response error: " + e)
						console.log(e);
					});
				});
				break;
		}
		
        request.on('error', function (err) {
            console.log("Request on error fired: " + err);
        });

        request.end();
    }

    function generateAuthorization(loc, epoch, key, secret)
	{
        var Request = "GET" + "\n" + "text/plain; charset=UTF-8" + "\n" + epoch + "\n" + loc;
        var authorization = "M2C" + " " + key + ":" + generateHmac(Request, secret);

        return authorization;
    }

    function generateHmac(data, secret, algorithm, encoding)
	{
        var encoding = encoding || "base64";
        var algorithm = algorithm || "sha1";

        return crypto.createHmac(algorithm, secret).update(data).digest(encoding);
	}

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("savvy", savvyNode);

	// Retrieve input from the left button (Start/Stop button)
	// Ojo, esto maneja el clic sobre el botón propio del nodo pero no solo vale para arrancar un stream sino que para enviar un input normal. 
	RED.httpAdmin.post("/savvy/:id", RED.auth.needsPermission("savvy.write"), function(req, res) {
		var adminNode = RED.nodes.getNode(req.params.id);
		if (adminNode != null) {
			try {
				console.log("Clic en el botón del nodo");
				console.log("Admin target es: " + adminNode.target);
				console.log("Stream status antes de cambiar: " + adminNode.streamStatus);
				// We change the status flag
				adminNode.streamStatus = !adminNode.streamStatus;
				// Stop button
				if(!adminNode.streamStatus && (adminNode.target === "stream"))
				{
					console.log("Stopping the stream");
					// https://nodejs.org/api/http.html#http_http_request_options_callback
					// Stop the stream, The request will be stopped once the button has been clicked and the next response has been transmitted.
					request.abort();
					request.end();
					console.log("Stream stopped");
				}
				// Start button
				else
				{
					console.log("No hay flujo de streaming que parar por lo que se envía una señal de entrada al nodo");
					adminNode.receive();
				}
				res.sendStatus(200);
			} catch(err) {
				res.sendStatus(500);
				adminconsole.log(RED._("savvy.failed", {error:err.toString()}));
			}
		} else {
			res.sendStatus(404);
		}
	});

}