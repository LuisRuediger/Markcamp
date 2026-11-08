import type { SignInFailureKind } from '../../core/sessionStore'

export const ptBR = {
  appTitle: 'MarkCamp',
  loading: 'Carregando…',
  configError: {
    title: 'Erro de configuração',
    missingVariables: 'Variáveis de ambiente ausentes:',
  },
  signIn: {
    email: 'Email',
    password: 'Senha',
    submit: 'Entrar',
    google: 'Entrar com Google',
    sessionExpired: 'Sua sessão expirou, entre de novo',
    errors: {
      invalidCredentials: 'Email ou senha incorretos',
      invalidEmail: 'Email inválido',
      tooManyAttempts: 'Muitas tentativas. Espere um pouco e tente de novo',
      popupBlocked: 'O navegador bloqueou a janela do Google. Permita pop-ups e tente de novo',
      network: 'Sem conexão. Verifique a internet e tente de novo',
      unknown: 'Não foi possível entrar. Tente de novo',
    } satisfies Record<SignInFailureKind, string>,
  },
  home: {
    signedInAs: (email: string) => `Você entrou como ${email}`,
    signedIn: 'Você entrou',
    backendChecking: 'Conectando ao servidor…',
    backendOk: 'Conectado',
    backendUnavailable: 'Servidor indisponível no momento',
    signOut: 'Sair',
  },
} as const
