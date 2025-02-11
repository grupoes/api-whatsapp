import { createBot, createFlow, MemoryDB, createProvider, addKeyword } from '@bot-whatsapp/bot'

import { BaileysProvider, handleCtx } from "@bot-whatsapp/provider-baileys";

const flowBienvenida = addKeyword('hola').addAnswer('Buenas!! bienvenido');

const main = async () => {

    const provider = createProvider(BaileysProvider)

    provider.initHttpServer(3002);

    provider.http?.server.post('/send-message', handleCtx(async (bot, req, res) => {
        const body = req.body;
        
        const message = body.message;
        const mediaUrl = body.mediaUrl;
        const number = body.number;

        const response = await bot.sendMessage(number, message, {
            media: mediaUrl
        });
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            success: true,
            message: 'Mensaje enviado correctamente',
            response
        }));

    }))

    await createBot({
        flow: createFlow([flowBienvenida]),
        database: new MemoryDB(),
        provider
    })
}


main()