import type { SignInFailureKind } from '../../core/sessionStore'

export const ptBR = {
  appTitle: 'MarkCamp',
  loading: 'Carregando…',
  retry: 'Tentar de novo',
  installBanner:
    'Instale o MarkCamp na tela de início para não perder registros ainda não enviados. No iPhone: Compartilhar → Adicionar à Tela de Início.',
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
    signOut: 'Sair',
  },
  localSession: {
    needsFirstOnline: 'O primeiro acesso neste aparelho precisa de internet.',
    failed: 'Não foi possível abrir os dados deste aparelho. Feche o app e abra de novo.',
  },
  sync: {
    syncing: 'Sincronizando…',
    offline: 'Sem conexão com o servidor. Seus registros ficam no aparelho',
    // "registros", not "projetos": the same text holds when bait sites and events are queued.
    pending: (count: number) => (count === 1 ? '1 registro aguardando envio' : `${count} registros aguardando envio`),
    notYet: 'Ainda não sincronizado',
    synced: 'Sincronizado',
    syncNow: 'Sincronizar agora',
  },
  projects: {
    title: 'Projetos',
    loading: 'Carregando projetos…',
    empty: 'Crie seu primeiro projeto',
    nameLabel: 'Nome do projeto',
    create: 'Criar projeto',
    pendingMark: 'aguardando envio',
    rejectedName: 'O servidor recusou o nome deste projeto (não pode ficar em branco nem passar de 100 caracteres)',
    rejectedOther: 'O servidor recusou este projeto',
    discard: 'Descartar',
    confirmDiscard: 'Confirmar descarte',
    cancel: 'Cancelar',
    saveFailed: 'Não foi possível salvar no aparelho. Tente de novo',
    changeFailed: 'Não foi possível alterar o registro no aparelho. Tente de novo',
  },
} as const
