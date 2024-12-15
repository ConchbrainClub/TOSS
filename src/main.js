export default {
	async fetch(request, env) {
		let headers = new Headers()
		headers.set('Access-Control-Allow-Origin', '*')
		headers.set('Access-Control-Allow-Methods', '*')
		headers.set('Access-Control-Allow-Headers', '*')

		let url = new URL(request.url)
		let objectName = url.pathname.slice(1)

		console.log(`${request.method} object ${objectName}: ${request.url}`)

		if (!objectName) {
			let prefix = url.searchParams.get('prefix')

			if (!prefix) {
				return new Response(`
					<div style="text-align:center; margin-top: 100px;">
						<p>Welcome to ConchBrain OSS</p>
						<p>Please visit <a href="https://www.conchbrain.club/" target="_blank">here</a> to use</p>
					</div>
				`, {
					status: 200,
					headers: { 'Content-Type': 'text/html charset=utf-8' }
				})
			}

			let options = {
				prefix,
				delimiter: url.searchParams.get('delimiter') ?? undefined,
				cursor: url.searchParams.get('cursor') ?? undefined,
				include: ['customMetadata', 'httpMetadata'],
			}

			console.log(JSON.stringify(options))

			let listing = await env.BUCKET.list(options)
			headers.set('content-type', 'application/json; charset=UTF-8')
			return new Response(JSON.stringify(listing), { headers })
		}

		if (request.method == 'OPTIONS') {
			return new Response('ok', { headers })
		}

		if (request.method == 'HEAD') {
			let object = await env.BUCKET.head(objectName)
			if (!object) return new Response(`object ${objectName} is not found`, { status: 404 })

			object.writeHttpMetadata(headers)
			headers.set('Etag', object.httpEtag)
			return new Response(objectName, { headers })
		}

		if (request.method == 'GET') {
			let object = await env.BUCKET.get(objectName, {
				range: request.headers,
				onlyIf: request.headers,
			})
			if (!object) return new Response(`object ${objectName} is not found`, { status: 404 })

			this.genHeader(headers, object, Boolean(url.searchParams.get('attachment')))
			let status = object.body ? (request.headers.get("range") ? 206 : 200) : 304
			return new Response(object.body, { headers, status })
		}

		if (request.method == 'PUT' || request.method == 'POST') {
			if (objectName.startsWith(env.IGNORE)) {
				return new Response('Forbidden', { status: 403 })
			}

			let object = await env.BUCKET.put(objectName, request.body, {
				httpMetadata: request.headers,
			})

			headers.set('Etag', object.httpEtag)
			return new Response(objectName, { headers })
		}

		if (request.method == 'DELETE') {
			if (objectName.startsWith(env.IGNORE)) {
				return new Response('Forbidden', { status: 403 })
			}

			await env.BUCKET.delete(objectName)
			return new Response('deleted', { headers })
		}

		return new Response(`Unsupported method`, { status: 400 })
	},

	async scheduled(event, env, ctx) {
		let now = Date.now()

		let objects = (await env.BUCKET.list()).objects.map(i => {
			if (!i.key.startsWith(env.IGNORE)) return i
		}).filter(i => i)

		for (let object of objects) {
			let expires = Date.parse(object.uploaded) + 60 * 1000
			if (now < expires) return

			console.log(`delete: ${object.key}`)
			await env.BUCKET.delete(object.key)
		}
	},

	async genHeader(headers, object, attachment = false) {
		let fileName = object.key.split('/').at(-1)
		let extName = fileName.substring(fileName.lastIndexOf('.') + 1)

		switch (true) {
			case fileName.endsWith('.html'):
				headers.set('Content-Type', 'text/html; charset=utf-8')
				break

			case fileName.endsWith('.txt'):
				headers.set('Content-Type', 'text/plain; charset=utf-8')
				break

			case fileName.endsWith('.js'):
				headers.set('Content-Type', 'text/javascript; charset=utf-8')
				break

			case fileName.endsWith('.css'):
				headers.set('Content-Type', 'text/css; charset=utf-8')
				break

			case fileName.endsWith('.jpg'):
			case fileName.endsWith('.jpeg'):
			case fileName.endsWith('.png'):
			case fileName.endsWith('.svg'):
				headers.set('Content-Type', `image/${extName}`)
				break

			default:
				headers.set('Content-Type', 'application/octet-stream')
				break
		}

		headers.set('Content-Length', object.size)
		headers.set('Etag', object.httpEtag)

		if (attachment) {
			headers.set('Content-Disposition', `attachment; filename=${fileName}`)
		}

		if (object.range) {
			headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.end ?? object.size - 1}/${object.size}`)
		}
	}
}