import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'

function App(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Commons</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Search your club&apos;s docs — local-first RAG for student organizations.
          </p>
          <Button>Get Started</Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default App
