import { ptBR } from './i18n/pt-BR'

interface ConfigErrorScreenProps {
  missing: readonly string[]
}

function ConfigErrorScreen({ missing }: ConfigErrorScreenProps) {
  return (
    <main>
      <h1>{ptBR.configError.title}</h1>
      <p>{ptBR.configError.missingVariables}</p>
      <ul>
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  )
}

export default ConfigErrorScreen
