import React from 'react'
import { ApiContext } from './context'

export function useApiContext() {
  return React.useContext(ApiContext) || {}
}

export function useClient() {
  return useApiContext().client
}

export function useIsFetching() {
  const client = useClient()

  const [isFetching, setIsFetching] = React.useState(() => {
    return client.isFetching()
  })

  React.useEffect(() => {
    return client.subscribe(() => {
      setIsFetching(client.isFetching())
    })
  }, [])

  return isFetching
}

export function useQuery(queryArg, config) {
  const {
    client,
    ssr = client.ssrMode,
    cacheTime = client.config.cacheTime,
    staleTime = client.config.staleTime,
    onSuccess,
    onError,
    initialData,
    header,
    hydrate,
  } = {
    ...useApiContext(),
    ...config,
  }

  const query = client.getQuery(queryArg)

  const stateRef = React.useRef()
  const rerender = React.useReducer(i => ++i, 0)[1]

  const mountedRef = React.useRef(false)

  const refetch = () => {
    if (!query.url) {
      return null
    }
    return client.fetch(query, {
      force: true,
      cacheTime,
      header,
      hydrate,
    })
  }

  const setData = data => {
    data = typeof data === 'function' ? data(stateRef.current.data) : data
    stateRef.current.data = data
    rerender()
  }

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = null }
  }, [])

  React.useMemo(() => {
    if (!query.key) {
      stateRef.current = {
        data: initialData,
        isLoading: false,
        isFetching: false,
        ...stateRef.current,
      }
    } else if (client.isCached(query, cacheTime)) {
      stateRef.current = {
        isLoading: false,
        isFetching: staleTime !== null && !client.isCached(query, staleTime),
        ...client.normalize(query.cache),
      }
    } else {
      stateRef.current = {
        data: initialData,
        ...stateRef.current,
        isLoading: true,
        isFetching: true,
      }
    }
  }, [query.url])

  React.useEffect(() => {
    const cleanup = query.subscribe(req => {
      let state

      if (req.result) {
        state = { isLoading: false, isFetching: false, ...req.result }

        if (state.data && onSuccess) {
          onSuccess(req.result)
        } else if (state.error && state.error.name === 'AbortError') {
          state = { ...stateRef.current, ...state }
          delete state.error
        } else if ((state.error || state.errors) && onError) {
          onError(req.result)
        }
      } else if (req.isFetching && !stateRef.current.isFetching) {
        state = { ...stateRef.current, isFetching: true }
      }

      if (state && mountedRef.current) {
        stateRef.current = state
        rerender()
      }
    })

    if (stateRef.current.isFetching) {
      refetch()
    }

    return () => {
      cleanup()
      client.scheduleGC(query)
    }
  }, [query])

  if (
    ssr !== false &&
    client.config.ssrMode &&
    !query.cache
  ) {
    refetch()
  }

  return {
    ...stateRef.current,
    refetch,
    setData,
    client,
  }
}

export function useMutation(queryArg, config = {}) {
  const {
    client = useClient(),
    initialData,
    onSuccess,
    onError,
    ...options
  } = config

  const mountedRef = React.useRef(false)

  const query = client.getQuery(queryArg)

  const [state, setState] = React.useState({
    data: initialData,
    isLoading: false,
  })

  const setData = data => {
    setState(prev => ({
      ...prev,
      data: typeof data === 'function' ? data(state.data) : data,
    }))
  }

  const setErrors = errors => {
    setState(prev => ({
      ...prev,
      errors: typeof errors === 'function' ? errors(state.errors) : errors,
    }))
  }

  React.useEffect(() => {
    setData(initialData)
  }, [query])

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = null }
  }, [])

  const mutate = async data => {
    if (state.promise) {
      return state.promise
    }

    const promise = client.mutate(query, data, options)

    setState(prev => ({
      ...prev,
      isLoading: true,
      promise,
    }))

    const result = await promise

    if (mountedRef.current) {
      if (result.data) {
        if (onSuccess) {
          onSuccess(result)
        }
        setState({
          isLoading: false,
          ...result,
        })
      } else {
        if (onError) {
          onError(result)
        }
        setState(({ promise, error, errors, ...prev }) => ({
          ...prev,
          ...result,
          isLoading: false,
        }))
      }
    }

    return result
  }

  return [mutate, { ...state, setData, setErrors, client }]
}
