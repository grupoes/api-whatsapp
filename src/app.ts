import { createBot, createFlow, MemoryDB, createProvider } from '@bot-whatsapp/bot';
import { BaileysProvider, handleCtx } from "@bot-whatsapp/provider-baileys";
import fs from 'fs';

// Configuración
const logMessage = (message: string): void => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync('bot-log.txt', logEntry);
    console.log(logEntry.trim());
};

interface MessageData {
    number: string;
    message: string;
    mediaUrl?: string;
    retryCount: number;
    status?: 'PENDING' | 'FAILED' | 'SENT';
}

const messageQueue: MessageData[] = [];
const MAX_RETRIES = 3;
const MESSAGE_TIMEOUT = 10000; // 10 segundos
let isProcessing = false;

// Función con timeout para el envío
const sendWithTimeout = async (bot: any, messageData: MessageData): Promise<boolean> => {
    return new Promise(async (resolve) => {
        const timeout = setTimeout(() => {
            logMessage(`⌛ Timeout superado para ${messageData.number}`);
            resolve(false);
        }, MESSAGE_TIMEOUT);

        try {
            await bot.sendMessage(messageData.number, messageData.message, {
                media: messageData.mediaUrl
            });
            clearTimeout(timeout);
            resolve(true);
        } catch (error) {
            clearTimeout(timeout);
            resolve(false);
        }
    });
};

// Procesador de cola mejorado
const processQueue = async (bot: any) => {
    if (isProcessing || messageQueue.length === 0) return;

    isProcessing = true;
    const messageData = messageQueue[0]; // Trabaja con el primer elemento sin removerlo aún

    logMessage(`🔁 Procesando ${messageData.number} (Intento ${messageData.retryCount + 1}/${MAX_RETRIES})`);

    const success = await sendWithTimeout(bot, messageData);

    if (success) {
        messageData.status = 'SENT';
        messageQueue.shift(); // Remover solo después de éxito
        logMessage(`✅ Enviado a ${messageData.number}`);
    } else {
        messageData.retryCount++;
        
        if (messageData.retryCount >= MAX_RETRIES) {
            messageData.status = 'FAILED';
            const failedMessage = messageQueue.shift(); // Remover definitivamente
            logMessage(`❌ Fallo definitivo para ${failedMessage?.number}`);
        }
    }

    isProcessing = false;
    
    // Procesar siguiente mensaje inmediatamente
    if (messageQueue.length > 0) {
        setTimeout(() => processQueue(bot), 0);
    }
};

// Inicialización del bot (similar al código anterior)
const initializeBot = async () => {
    const provider = createProvider(BaileysProvider);
    
    provider.initHttpServer(3002);

    provider.http?.server?.post('/send-message', handleCtx(async (bot, req, res) => {
        const { number, message, mediaUrl } = req.body;
        
        if (!number) {
            return res.status(400).json({ error: 'Número requerido' });
        }

        messageQueue.push({
            number,
            message,
            mediaUrl,
            retryCount: 0,
            status: 'PENDING'
        });

        processQueue(bot); // Iniciar procesamiento
        
        res.json({
            success: true,
            inQueue: messageQueue.length
        });
    }));

    return await createBot({
        flow: createFlow([]),
        database: new MemoryDB(),
        provider
    });
};

// Manejo de errores
process.on('unhandledRejection', (error) => {
    logMessage(`⚠ Error no manejado: ${error instanceof Error ? error.message : String(error)}`);
});

// Inicio
(async () => {
    await initializeBot();
    logMessage("🤖 Bot iniciado correctamente");
})();