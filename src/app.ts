import { createBot, createFlow, MemoryDB, createProvider, addKeyword } from '@bot-whatsapp/bot'
import { BaileysProvider, handleCtx } from "@bot-whatsapp/provider-baileys";
import fs from 'fs';

// Flujo básico de bienvenida
const flowBienvenida = addKeyword('hola').addAnswer('Buenas!! bienvenido');

// Configurar registro de logs
const logMessage = (message: string): void => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    
    fs.appendFileSync('bot-log.txt', logEntry);
    console.log(logEntry.trim());
};

// Tipos e interfaces
interface ConnectionState {
    isConnected: boolean;
    reconnectAttempts: number;
    pingInterval: NodeJS.Timeout | null; // Modificado para aceptar tanto Timeout como null
}

// Estado de la conexión
const state: ConnectionState = {
    isConnected: false,
    reconnectAttempts: 0,
    pingInterval: null
};

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 30000; // 30 segundos

// Función para limpiar intervalos
const clearIntervals = (): void => {
    if (state.pingInterval) {
        clearInterval(state.pingInterval);
        state.pingInterval = null;
    }
};

// Inicializar bot con manejo de reconexión
const initializeBot = async (): Promise<any> => {
    try {
        logMessage("Inicializando bot de WhatsApp...");
        
        // Crear el proveedor sin opciones personalizadas para evitar errores de TypeScript
        const provider = createProvider(BaileysProvider);
        
        // Acceder al evento de conexión de manera segura
        if (provider.vendor && provider.vendor.ev) {
            // Usar anotación de tipo para evitar errores de TypeScript
            const vendorEvents = provider.vendor.ev as any;
            
            vendorEvents.on('connection.update', (update: any) => {
                const { connection, lastDisconnect } = update || {};
                
                if (connection === 'open') {
                    state.isConnected = true;
                    state.reconnectAttempts = 0;
                    logMessage("¡Bot conectado correctamente!");
                    
                    // Iniciar verificación periódica
                    clearIntervals();
                    state.pingInterval = setInterval(() => {
                        if (state.isConnected) {
                            logMessage("Verificación periódica: Bot activo y conectado");
                        } else {
                            logMessage("Verificación periódica: Bot desconectado");
                            clearIntervals();
                            
                            // Intentar reconectar automáticamente
                            if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                                state.reconnectAttempts++;
                                logMessage(`Intentando reconectar (intento ${state.reconnectAttempts})...`);
                                setTimeout(initializeBot, RECONNECT_INTERVAL);
                            }
                        }
                    }, 300000); // cada 5 minutos
                }
                
                if (connection === 'close') {
                    state.isConnected = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    logMessage(`Conexión cerrada. Código de estado: ${statusCode || 'desconocido'}`);
                    
                    clearIntervals();
                    
                    // Manejar reconexión
                    if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        state.reconnectAttempts++;
                        const delay = RECONNECT_INTERVAL * state.reconnectAttempts;
                        logMessage(`Intentando reconectar en ${delay/1000} segundos (intento ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                        
                        setTimeout(initializeBot, delay);
                    } else {
                        logMessage("Máximo de intentos de reconexión alcanzados. Por favor, reinicie el servicio manualmente.");
                    }
                }
            });
        }

        // Configurar servidor HTTP para endpoint de API
        provider.initHttpServer(3002);

        // Verificar que el servidor HTTP existe
        if (provider.http?.server) {
            // Endpoint de verificación de salud
            provider.http.server.get('/health', (req, res) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    status: state.isConnected ? 'conectado' : 'desconectado',
                    uptime: process.uptime(),
                    reconnectAttempts: state.reconnectAttempts,
                    timestamp: new Date().toISOString()
                }));
            });

            // Endpoint para reinicio manual
            provider.http.server.get('/restart', (req, res) => {
                // Reiniciar el bot
                logMessage("Reiniciando el bot manualmente...");
                clearIntervals();
                state.reconnectAttempts = 0;
                state.isConnected = false;
                
                // Reiniciar con un ligero retraso
                setTimeout(() => {
                    initializeBot().then(() => {
                        logMessage("Bot reiniciado correctamente");
                    }).catch(error => {
                        logMessage(`Error al reiniciar el bot: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }, 1000);
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    success: true,
                    message: "Reinicio del bot iniciado"
                }));
            });

            // Endpoint para envío de mensajes
            provider.http.server.post('/send-message', handleCtx(async (bot, req, res) => {
                try {
                    const body = req.body;
                    
                    const message = body.message;
                    const mediaUrl = body.mediaUrl;
                    const number = body.number;

                    if (!number) {
                        throw new Error('El número de teléfono es obligatorio');
                    }

                    logMessage(`Enviando mensaje a ${number}`);
                    
                    const response = await bot.sendMessage(number, message, {
                        media: mediaUrl
                    });
                    
                    logMessage(`Mensaje enviado correctamente a ${number}`);
                    
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        success: true,
                        message: 'Mensaje enviado correctamente',
                        response
                    }));
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logMessage(`Error al enviar mensaje: ${errorMessage}`);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        success: false,
                        message: 'Error al enviar mensaje',
                        error: errorMessage
                    }));
                }
            }));
        }

        // Crear la instancia del bot
        const botInstance = await createBot({
            flow: createFlow([flowBienvenida]),
            database: new MemoryDB(),
            provider
        });
        
        return botInstance;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logMessage(`Error crítico al inicializar el bot: ${errorMessage}`);
        
        // Si la inicialización falla, intentar de nuevo después de un retraso
        if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            state.reconnectAttempts++;
            const delay = RECONNECT_INTERVAL * state.reconnectAttempts;
            logMessage(`Reintentando inicialización en ${delay/1000} segundos...`);
            setTimeout(initializeBot, delay);
        }
        return null;
    }
};

// Manejar rechazos y excepciones no controladas
process.on('unhandledRejection', (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logMessage(`Rechazo de promesa no manejado: ${errorMessage}`);
});

process.on('uncaughtException', (error: Error) => {
    logMessage(`Excepción no capturada: ${error.message}`);
    // No cerramos el proceso, dejamos que PM2 lo maneje
});

// Iniciar el bot
const main = async (): Promise<void> => {
    logMessage("Iniciando servicio de bot de WhatsApp...");
    await initializeBot();
};

main();