type Task = () => Promise<void>

export default class Queue {
  private queue: Task[] = []
  private executing = false

  post(task: Task): void {
    this.queue.push(task)
    if (this.executing) {
      return
    }

    this.executing = true
    this.process()
  }

  private process() {
    if (this.queue.length > 0) {
      const [run] = this.queue.splice(0, 1)
      void run().then(this.process)
      return
    }
    this.executing = false
  }
}
