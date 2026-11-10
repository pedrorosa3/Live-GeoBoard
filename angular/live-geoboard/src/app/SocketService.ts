import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;

  constructor() {
    this.socket = io('http://localhost:3000');
  }

  // Escutar novos pontos vindos do Node
  onNewPoint(): Observable<any> {
    return new Observable((observer) => {
      this.socket.on('point_added', (point) => {
        observer.next(point);
      });
    });
  }

  // Enviar um ponto para o Node
  sendPoint(point: any) {
    this.socket.emit('new_point', point);
  }
}