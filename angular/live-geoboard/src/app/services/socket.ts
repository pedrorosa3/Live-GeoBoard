import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;

  constructor() {
    // Liga-se ao teu servidor Node.js na porta 3000
    this.socket = io('http://localhost:3000');
  }

  // Escuta os pontos que vêm da Base de Dados/Servidor
  onNewPoint(): Observable<any> {
    return new Observable((observer) => {
      this.socket.on('point_added', (point) => {
        observer.next(point);
      });
    });
  }

  // Envia um novo ponto criado pelo utilizador para o Servidor
  sendPoint(point: { lat: number, lng: number, title: string, category: string }) {
    this.socket.emit('new_point', point);
  }
}
