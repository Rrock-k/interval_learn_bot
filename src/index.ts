import { config } from './config';
import { CardStore } from './db';
import { createBot } from './bot';
import { ReviewScheduler } from './reviewScheduler';
import { logger } from './logger';
import { createHttpServer } from './httpServer';

const main = async () => {
  const store = new CardStore(config.databaseUrl);
  await store.init();
  const bot = createBot(store);
  const scheduler = new ReviewScheduler(store, bot);
  const httpServer = createHttpServer(store, scheduler, bot);

  await bot.launch();
  logger.info('Бот запущен и ожидает сообщения');

  scheduler.start();
  logger.info(
    `Планировщик повторений активирован (проверка каждые ${
      config.scheduler.scanIntervalMs / 1000
    } секунд)`,
  );

  const gracefulShutdown = (signal: string) => {
    logger.info(`Получен сигнал ${signal}, завершаем работу...`);
    scheduler.stop();
    httpServer.close(() => {
      bot.stop(signal);
      store
        .close()
        .catch((error) => {
          logger.error('Ошибка при закрытии подключения к БД', error);
        })
        .finally(() => process.exit(0));
    });
  };

  process.once('SIGINT', () => {
    gracefulShutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
  });
};

main().catch((error) => {
  logger.error('Фатальная ошибка приложения', error);
  process.exit(1);
});
