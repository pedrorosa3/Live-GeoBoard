import { Injectable, effect, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { API_URL, GeoPoint } from '../config';
import { AuthService } from './auth';

interface Ack {
  ok?: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private auth = inject(AuthService);
  private socket: Socket;

  constructor() {
    // O token é enviado em cada ligação; sem token a ligação é anónima (só leitura)
    this.socket = io(API_URL, {
      auth: (cb) => cb({ token: this.auth.token() })
    });

    // Quando o utilizador entra ou sai, volta a ligar para o servidor saber quem é
    let firstRun = true;
    effect(() => {
      this.auth.token();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.socket.disconnect().connect();
    });
  }

  onPointAdded(): Observable<GeoPoint> {
    return this.listen('point_added');
  }

  onPointUpdated(): Observable<GeoPoint> {
    return this.listen('point_updated');
  }

  onPointRemoved(): Observable<{ _id: string }> {
    return this.listen('point_removed');
  }

  createPoint(point: { lat: number; lng: number; title: string; category: string }) {
    return this.request('new_point', point);
  }

  updatePoint(id: string, changes: { title: string; category: string }) {
    return this.request('update_point', { id, ...changes });
  }

  deletePoint(id: string) {
    return this.request('delete_point', { id });
  }

  private listen<T>(event: string): Observable<T> {
    return new Observable<T>((observer) => {
      const handler = (data: T) => observer.next(data);
      this.socket.on(event, handler);
      return () => this.socket.off(event, handler);
    });
  }

  // Envia um evento e espera pela resposta do servidor; lança erro se falhar
  private async request(event: string, payload: unknown): Promise<void> {
    let ack: Ack;
    try {
      ack = await this.socket.timeout(5000).emitWithAck(event, payload);
    } catch {
      throw new Error('O servidor não respondeu. Tenta outra vez.');
    }
    if (ack?.error) throw new Error(ack.error);
  }
}
