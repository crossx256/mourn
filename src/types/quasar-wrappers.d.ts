import type { Application, Request, Response } from 'express';
import type { Server } from 'node:http';

export {};

declare module '#q-app' {
  interface SsrDriver {
    app: Application;
    listenResult: Server;
    request: Request;
    response: Response;
  }
}
