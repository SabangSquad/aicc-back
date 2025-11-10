import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AICC API",
      version: "1.0.0",
      description: "AICC 프로젝트 백엔드 API 문서"
    },
    // 로컬/배포 겸용
    servers: [{ url: '/' }, { url: '/api' }],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

function setupSwagger(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  // 모두 /api/docs로 동작하도록 다시 마운트
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

export default setupSwagger;
