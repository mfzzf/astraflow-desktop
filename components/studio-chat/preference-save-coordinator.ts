export class PreferenceSaveCoordinator {
  private tail: Promise<void> = Promise.resolve()
  private version = 0

  enqueue<T>(save: () => Promise<T>): Promise<T> {
    this.version += 1

    const result = this.tail.then(save)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )

    return result
  }

  async captureIdleVersion(): Promise<number> {
    while (true) {
      const tail = this.tail
      const version = this.version

      await tail

      if (tail === this.tail && version === this.version) {
        return version
      }
    }
  }

  isCurrent(version: number): boolean {
    return version === this.version
  }
}
