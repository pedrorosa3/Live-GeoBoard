import { Injectable, computed, signal } from '@angular/core';
import { API_URL, PointOwner } from '../config';

interface Session {
  token: string;
  user: PointOwner;
}

const STORAGE_KEY = 'geoboard_session';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private session = signal<Session | null>(this.restoreSession());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);

  login(username: string, password: string) {
    return this.authenticate('login', username, password);
  }

  register(username: string, password: string) {
    return this.authenticate('register', username, password);
  }

  logout() {
    this.session.set(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  private async authenticate(mode: 'login' | 'register', username: string, password: string) {
    const response = await fetch(`${API_URL}/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error ?? 'Não foi possível iniciar sessão.');
    }

    const session: Session = { token: data.token, user: data.user };
    this.session.set(session);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch {}
  }

  // Recupera a sessão guardada, se o token ainda não tiver expirado
  private restoreSession(): Session | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const session: Session = JSON.parse(raw);
      const payload = JSON.parse(atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }
}
